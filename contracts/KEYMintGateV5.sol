// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IKEYTokenV5 {
    function mintByGate(address to, uint256 amount) external;
}

interface IKEYMintFeeVaultV5 {
    function depositMintFee(address minter) external payable;
}

/// @title KEY Mint Gate V5
/// @notice Clean mint gate for the final auto-liquidity vault deployment.
contract KEYMintGateV5 {
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
    uint256 public constant MIN_REWARD = 500 ether;
    uint256 public constant WALLET_CAP = 10;

    bytes32 public constant MINT_ATTESTATION_TYPEHASH = keccak256(
        "MintAttestation(address recipient,bytes32 publicKeyHash,bytes32 signatureHash,bytes32 rewardHash,uint256 rewardAmount,uint256 epoch,uint256 deadline)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    IKEYTokenV5 public immutable token;
    IKEYMintFeeVaultV5 public immutable treasuryVault;
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

    constructor(address token_, address treasuryVault_, address attestationSigner_) {
        require(token_ != address(0), "bad token");
        require(treasuryVault_ != address(0), "bad vault");
        require(attestationSigner_ != address(0), "bad signer");
        token = IKEYTokenV5(token_);
        treasuryVault = IKEYMintFeeVaultV5(treasuryVault_);
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

    function walletMintsTotal(address minter) public view returns (uint256) {
        return walletMints[minter];
    }

    function walletRemainingMints(address minter) public view returns (uint256) {
        uint256 minted = walletMints[minter];
        return minted >= WALLET_CAP ? 0 : WALLET_CAP - minted;
    }

    function publicMintedTotal() public view returns (uint256) {
        return publicMinted;
    }

    function mintOutReached() public view returns (bool) {
        return publicMinted >= PUBLIC_MINT_POOL || PUBLIC_MINT_POOL - publicMinted < MIN_REWARD;
    }

    function mintWithAttestation(MintAttestation calldata a, bytes calldata signature) external payable nonReentrant {
        require(msg.value == MINT_PRICE, "wrong mint price");
        require(a.recipient == msg.sender, "recipient mismatch");
        require(block.timestamp <= a.deadline, "attestation expired");
        bytes32 id = proofId(a);
        require(!usedProofId[id], "proof used");
        require(!usedPublicKeyHash[a.publicKeyHash], "public key used");
        require(walletMints[a.recipient] < WALLET_CAP, "wallet cap reached");
        require(!mintOutReached(), "public pool filled");
        require(a.rewardHash == recomputeRewardHash(a), "bad reward hash");
        require(a.rewardAmount == rewardForHash(a.rewardHash), "bad reward amount");
        require(publicMinted + a.rewardAmount <= PUBLIC_MINT_POOL, "public pool filled");
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
