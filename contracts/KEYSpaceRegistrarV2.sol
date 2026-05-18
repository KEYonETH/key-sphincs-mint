// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IKEYBondTokenV2 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function publicMintedByGate() external view returns (uint256);
}

interface IKEYMintGateOriginV2 {
    function usedProofId(bytes32 proofId) external view returns (bool);
    function attestationSigner() external view returns (address);
}

interface IKEYIdentityMintV2 {
    function mintIdentity(
        address to,
        string calldata name,
        uint8 originRank,
        uint256 keyBond,
        address originWallet,
        bytes32 originProofId
    ) external returns (uint256 tokenId);

    function meltIdentity(uint256 tokenId) external returns (uint256 keyBond, address previousOwner);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title KEYSPACE Registrar V2
/// @notice Replacement registrar: ten valid KEY mints are required to claim one KEY Card NFT.
contract KEYSpaceRegistrarV2 is Ownable {
    struct MintAttestation {
        address recipient;
        bytes32 publicKeyHash;
        bytes32 signatureHash;
        bytes32 rewardHash;
        uint256 rewardAmount;
        uint256 epoch;
        uint256 deadline;
    }

    struct ClaimMint {
        address mintGate;
        MintAttestation attestation;
        bytes signature;
    }

    uint8 public constant RANK_NORMAL = 0;
    uint8 public constant RANK_CLEAN = 1;
    uint8 public constant RANK_GOLDEN = 2;
    uint8 public constant RANK_QUANTUM = 3;
    uint8 public constant RANK_GENESIS = 4;

    uint256 public constant PUBLIC_MINT_POOL = 10_000_000 ether;
    uint256 public constant REQUIRED_MINTS_PER_IDENTITY = 10;
    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 16;

    bytes32 public constant MINT_ATTESTATION_TYPEHASH = keccak256(
        "MintAttestation(address recipient,bytes32 publicKeyHash,bytes32 signatureHash,bytes32 rewardHash,uint256 rewardAmount,uint256 epoch,uint256 deadline)"
    );

    IKEYBondTokenV2 public immutable keyToken;
    IKEYIdentityMintV2 public immutable identity;

    bool public originClaimsOpen;
    uint16 public exitFeeBps;
    address public feeRecipient;
    bool private locked;

    mapping(address => bool) public allowedMintGate;
    mapping(address => bool) public claimedByWallet;
    mapping(bytes32 => bool) public claimedProofId;
    mapping(uint256 => uint256) public keyBondByTokenId;

    event MintGateAllowed(address indexed mintGate, bool allowed);
    event OriginClaimsOpenSet(bool open);
    event ExitFeeSet(uint16 exitFeeBps, address indexed feeRecipient);
    event IdentityClaimed(address indexed owner, uint256 indexed tokenId, string name, uint8 originRank, uint256 keyBond);
    event IdentityClaimBatch(address indexed owner, uint256 indexed tokenId, bytes32 indexed batchProofId, uint256 proofCount, uint256 keyBond);
    event IdentityMelted(uint256 indexed tokenId, address indexed owner, uint256 redeemedKeyBond, uint256 exitFee);

    error NotOpen();
    error MintOutNotReached();
    error InvalidMintGate();
    error InvalidAttestation();
    error ClaimAlreadyUsed();
    error ProofAlreadyClaimed();
    error DuplicateProof();
    error NotEnoughMintProofs();
    error InvalidName();
    error NameTooShort();
    error TransferFailed();
    error NotIdentityOwner();
    error InvalidExitFee();
    error Locked();

    modifier nonReentrant() {
        if (locked) revert Locked();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address initialOwner,
        address keyToken_,
        address identity_,
        address primaryMintGate,
        address[] memory legacyMintGates
    ) Ownable(initialOwner) {
        require(keyToken_ != address(0), "bad token");
        require(identity_ != address(0), "bad identity");
        keyToken = IKEYBondTokenV2(keyToken_);
        identity = IKEYIdentityMintV2(identity_);
        feeRecipient = initialOwner;

        _setMintGateAllowed(primaryMintGate, true);
        for (uint256 i = 0; i < legacyMintGates.length; i += 1) {
            _setMintGateAllowed(legacyMintGates[i], true);
        }
    }

    function setMintGateAllowed(address mintGate, bool allowed) external onlyOwner {
        _setMintGateAllowed(mintGate, allowed);
    }

    function setOriginClaimsOpen(bool open) external onlyOwner {
        if (open && !canOpenOriginClaims()) revert MintOutNotReached();
        originClaimsOpen = open;
        emit OriginClaimsOpenSet(open);
    }

    function setExitFee(uint16 nextExitFeeBps, address nextFeeRecipient) external onlyOwner {
        if (nextExitFeeBps > 1_000) revert InvalidExitFee();
        if (nextExitFeeBps > 0 && nextFeeRecipient == address(0)) revert InvalidExitFee();
        exitFeeBps = nextExitFeeBps;
        feeRecipient = nextFeeRecipient;
        emit ExitFeeSet(nextExitFeeBps, nextFeeRecipient);
    }

    function canOpenOriginClaims() public view returns (bool) {
        return keyToken.publicMintedByGate() >= PUBLIC_MINT_POOL;
    }

    function claimOrigin(ClaimMint[] calldata proofs, string calldata name) external nonReentrant returns (uint256 tokenId) {
        if (!originClaimsOpen) revert NotOpen();
        if (proofs.length != REQUIRED_MINTS_PER_IDENTITY) revert NotEnoughMintProofs();
        if (claimedByWallet[msg.sender]) revert ClaimAlreadyUsed();
        if (!_isValidName(name)) revert InvalidName();

        bytes32[] memory batchProofs = new bytes32[](proofs.length);
        uint256 keyBond = 0;
        uint8 bestRank = RANK_NORMAL;

        for (uint256 i = 0; i < proofs.length; i += 1) {
            ClaimMint calldata claim = proofs[i];
            if (!allowedMintGate[claim.mintGate]) revert InvalidMintGate();
            if (claim.attestation.recipient != msg.sender) revert InvalidAttestation();

            bytes32 proof = proofId(claim.attestation);
            if (claimedProofId[proof]) revert ProofAlreadyClaimed();
            for (uint256 j = 0; j < i; j += 1) {
                if (batchProofs[j] == proof) revert DuplicateProof();
            }
            batchProofs[i] = proof;

            IKEYMintGateOriginV2 gate = IKEYMintGateOriginV2(claim.mintGate);
            if (!gate.usedProofId(proof)) revert InvalidAttestation();
            if (claim.attestation.rewardHash != recomputeRewardHash(claim.attestation)) revert InvalidAttestation();
            if (claim.attestation.rewardAmount != rewardForHash(claim.attestation.rewardHash)) revert InvalidAttestation();
            if (_recover(_typedDataHash(claim.attestation, claim.mintGate), claim.signature) != gate.attestationSigner()) {
                revert InvalidAttestation();
            }

            keyBond += claim.attestation.rewardAmount;
            uint8 rank = rankForReward(claim.attestation.rewardAmount);
            if (rank > bestRank) bestRank = rank;
        }

        if (bytes(name).length < minNameLengthForRank(bestRank)) revert NameTooShort();

        claimedByWallet[msg.sender] = true;
        for (uint256 i = 0; i < batchProofs.length; i += 1) {
            claimedProofId[batchProofs[i]] = true;
        }

        if (!keyToken.transferFrom(msg.sender, address(this), keyBond)) revert TransferFailed();

        bytes32 batchProofId = keccak256(abi.encode(batchProofs));
        tokenId = identity.mintIdentity(msg.sender, name, bestRank, keyBond, msg.sender, batchProofId);
        keyBondByTokenId[tokenId] = keyBond;

        emit IdentityClaimed(msg.sender, tokenId, name, bestRank, keyBond);
        emit IdentityClaimBatch(msg.sender, tokenId, batchProofId, proofs.length, keyBond);
    }

    function meltIdentity(uint256 tokenId) external nonReentrant returns (uint256 redeemedKeyBond) {
        if (identity.ownerOf(tokenId) != msg.sender) revert NotIdentityOwner();
        (uint256 keyBond, address previousOwner) = identity.meltIdentity(tokenId);
        uint256 exitFee = (keyBond * exitFeeBps) / 10_000;
        redeemedKeyBond = keyBond - exitFee;
        keyBondByTokenId[tokenId] = 0;
        if (redeemedKeyBond > 0 && !keyToken.transfer(previousOwner, redeemedKeyBond)) revert TransferFailed();
        if (exitFee > 0 && !keyToken.transfer(feeRecipient, exitFee)) revert TransferFailed();
        emit IdentityMelted(tokenId, previousOwner, redeemedKeyBond, exitFee);
    }

    function proofId(MintAttestation calldata attestation) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            attestation.recipient,
            attestation.publicKeyHash,
            attestation.signatureHash,
            attestation.epoch,
            block.chainid,
            "KEY_PROOF_V1"
        ));
    }

    function recomputeRewardHash(MintAttestation calldata attestation) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            attestation.recipient,
            attestation.publicKeyHash,
            attestation.signatureHash,
            attestation.epoch,
            block.chainid
        ));
    }

    function rewardForHash(bytes32 rewardHash) public pure returns (uint256) {
        uint256 roll = uint256(rewardHash) % 10_000;
        if (roll < 10) return 21_000 ether;
        if (roll < 100) return 5_000 ether;
        if (roll < 500) return 1_500 ether;
        if (roll < 2_000) return 750 ether;
        return 500 ether;
    }

    function rankForReward(uint256 rewardAmount) public pure returns (uint8) {
        if (rewardAmount == 21_000 ether) return RANK_GENESIS;
        if (rewardAmount == 5_000 ether) return RANK_QUANTUM;
        if (rewardAmount == 1_500 ether) return RANK_GOLDEN;
        if (rewardAmount == 750 ether) return RANK_CLEAN;
        if (rewardAmount == 500 ether) return RANK_NORMAL;
        revert InvalidAttestation();
    }

    function minNameLengthForRank(uint8 rank) public pure returns (uint256) {
        if (rank == RANK_GENESIS) return 3;
        if (rank == RANK_QUANTUM) return 4;
        if (rank == RANK_GOLDEN) return 5;
        if (rank == RANK_CLEAN) return 6;
        if (rank == RANK_NORMAL) return 7;
        revert InvalidAttestation();
    }

    function _setMintGateAllowed(address mintGate, bool allowed) internal {
        if (mintGate == address(0)) revert InvalidMintGate();
        allowedMintGate[mintGate] = allowed;
        emit MintGateAllowed(mintGate, allowed);
    }

    function _typedDataHash(MintAttestation calldata attestation, address mintGate) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            MINT_ATTESTATION_TYPEHASH,
            attestation.recipient,
            attestation.publicKeyHash,
            attestation.signatureHash,
            attestation.rewardHash,
            attestation.rewardAmount,
            attestation.epoch,
            attestation.deadline
        ));
        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("KEYMintGate")),
            keccak256(bytes("1")),
            block.chainid,
            mintGate
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _isValidName(string calldata name) internal pure returns (bool) {
        bytes calldata raw = bytes(name);
        if (raw.length < MIN_NAME_LENGTH || raw.length > MAX_NAME_LENGTH) return false;
        for (uint256 i = 0; i < raw.length; i += 1) {
            bytes1 char = raw[i];
            if (char < 0x61 || char > 0x7a) return false;
        }
        return true;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        return ecrecover(digest, v, r, s);
    }
}
