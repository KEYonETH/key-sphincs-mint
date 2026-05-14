// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IKEYTokenV2 {
    function mintByGate(address to, uint256 amount) external;
}

interface IKEYTreasuryVaultV2 {
    function depositMintFee(address minter) external payable;
}

interface IKEYMintGateLegacy {
    function walletMints(address minter) external view returns (uint256);
    function usedProofId(bytes32 proofId) external view returns (bool);
    function usedPublicKeyHash(bytes32 publicKeyHash) external view returns (bool);
    function publicMinted() external view returns (uint256);
}

/// @title KEY Mint Gate V2
/// @notice Replacement mint gate that enforces one mint per wallet across the legacy gate and V2.
/// @dev Keeps the EIP-712 domain name/version compatible with KEYMintGate so the backend flow is unchanged.
contract KEYMintGateV2 {
    struct MintAttestation {
        address recipient;
        bytes32 publicKeyHash;
        bytes32 signatureHash;
        bytes32 rewardHash;
        uint256 rewardAmount;
        uint256 epoch;
        uint256 deadline;
    }

    uint256 public constant MINT_PRICE = 0.001 ether;
    uint256 public constant PUBLIC_MINT_POOL = 10_000_000 ether;
    uint256 public constant WALLET_CAP = 1;

    bytes32 public constant MINT_ATTESTATION_TYPEHASH = keccak256(
        "MintAttestation(address recipient,bytes32 publicKeyHash,bytes32 signatureHash,bytes32 rewardHash,uint256 rewardAmount,uint256 epoch,uint256 deadline)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    IKEYTokenV2 public immutable token;
    IKEYTreasuryVaultV2 public immutable treasuryVault;
    IKEYMintGateLegacy public immutable legacyMintGate;
    address public owner;
    address public attestationSigner;
    uint256 public publicMinted;
    bool private locked;

    mapping(address => uint256) public walletMints;
    mapping(bytes32 => bool) public usedProofId;
    mapping(bytes32 => bool) public usedPublicKeyHash;

    event Minted(
        address indexed recipient,
        bytes32 indexed proofId,
        bytes32 indexed publicKeyHash,
        bytes32 signatureHash,
        bytes32 rewardHash,
        uint256 rewardAmount,
        uint256 epoch,
        uint256 feePaid
    );
    event AttestationSignerSet(address indexed signer);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "locked");
        locked = true;
        _;
        locked = false;
    }

    constructor(address token_, address treasuryVault_, address attestationSigner_, address legacyMintGate_) {
        require(token_ != address(0), "bad token");
        require(treasuryVault_ != address(0), "bad vault");
        require(attestationSigner_ != address(0), "bad signer");
        require(legacyMintGate_ != address(0), "bad legacy gate");
        token = IKEYTokenV2(token_);
        treasuryVault = IKEYTreasuryVaultV2(treasuryVault_);
        legacyMintGate = IKEYMintGateLegacy(legacyMintGate_);
        owner = msg.sender;
        attestationSigner = attestationSigner_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("KEYMintGate")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function setAttestationSigner(address signer) external onlyOwner {
        require(signer != address(0), "bad signer");
        attestationSigner = signer;
        emit AttestationSignerSet(signer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function proofId(MintAttestation calldata a) public view returns (bytes32) {
        return keccak256(abi.encodePacked(a.recipient, a.publicKeyHash, a.signatureHash, a.epoch, block.chainid, "KEY_PROOF_V1"));
    }

    function recomputeRewardHash(MintAttestation calldata a) public view returns (bytes32) {
        return keccak256(abi.encodePacked(a.recipient, a.publicKeyHash, a.signatureHash, a.epoch, block.chainid));
    }

    function rewardForHash(bytes32 rewardHash) public pure returns (uint256) {
        uint256 roll = uint256(rewardHash) % 10_000;
        if (roll < 10) return 21_000 ether;
        if (roll < 100) return 5_000 ether;
        if (roll < 500) return 1_500 ether;
        if (roll < 2_000) return 750 ether;
        return 500 ether;
    }

    function legacyWalletMints(address minter) public view returns (uint256) {
        return legacyMintGate.walletMints(minter);
    }

    function publicMintedTotal() public view returns (uint256) {
        return legacyMintGate.publicMinted() + publicMinted;
    }

    function mintWithAttestation(MintAttestation calldata a, bytes calldata signature) external payable nonReentrant {
        require(msg.value == MINT_PRICE, "wrong mint price");
        require(a.recipient == msg.sender, "recipient mismatch");
        require(block.timestamp <= a.deadline, "attestation expired");
        bytes32 id = proofId(a);
        require(!legacyMintGate.usedProofId(id) && !usedProofId[id], "proof used");
        require(!legacyMintGate.usedPublicKeyHash(a.publicKeyHash) && !usedPublicKeyHash[a.publicKeyHash], "public key used");
        require(legacyMintGate.walletMints(a.recipient) + walletMints[a.recipient] < WALLET_CAP, "wallet cap reached");
        require(a.rewardHash == recomputeRewardHash(a), "bad reward hash");
        require(a.rewardAmount == rewardForHash(a.rewardHash), "bad reward amount");
        require(publicMintedTotal() + a.rewardAmount <= PUBLIC_MINT_POOL, "public pool filled");
        require(_recover(_typedDataHash(a), signature) == attestationSigner, "bad attestation");

        usedProofId[id] = true;
        usedPublicKeyHash[a.publicKeyHash] = true;
        walletMints[a.recipient] += 1;
        publicMinted += a.rewardAmount;

        treasuryVault.depositMintFee{value: msg.value}(a.recipient);
        token.mintByGate(a.recipient, a.rewardAmount);

        emit Minted(a.recipient, id, a.publicKeyHash, a.signatureHash, a.rewardHash, a.rewardAmount, a.epoch, msg.value);
    }

    function _typedDataHash(MintAttestation calldata a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            MINT_ATTESTATION_TYPEHASH,
            a.recipient,
            a.publicKeyHash,
            a.signatureHash,
            a.rewardHash,
            a.rewardAmount,
            a.epoch,
            a.deadline
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
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
