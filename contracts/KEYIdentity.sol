// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title KEYSPACE Origin Identity
/// @notice ERC721 identity layer for .key names. Minting and melting are controlled by the KEYSPACE registrar.
contract KEYIdentity is ERC721, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_IDENTITIES = 21_000;
    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 16;

    struct Identity {
        string name;
        uint8 originRank;
        uint256 keyBond;
        address originWallet;
        bytes32 originProofId;
        bool melted;
    }

    uint256 public nextTokenId = 1;
    address public registrar;

    string private baseMetadataURI;

    mapping(uint256 => Identity) private identities;
    mapping(uint256 => bytes32) public nameHashByTokenId;
    mapping(bytes32 => uint256) public tokenByNameHash;

    event RegistrarSet(address indexed registrar);
    event BaseURISet(string baseURI);
    event IdentityMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string name,
        uint8 originRank,
        uint256 keyBond,
        address indexed originWallet,
        bytes32 originProofId
    );
    event IdentityMelted(uint256 indexed tokenId, address indexed owner, string name, uint256 keyBond);

    error NotRegistrar();
    error InvalidRegistrar();
    error InvalidRecipient();
    error InvalidName();
    error NameTaken();
    error SupplySoldOut();
    error NonexistentIdentity();

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    constructor(address initialOwner, string memory initialBaseURI)
        ERC721("KEYSPACE Origin Identity", "KEYID")
        Ownable(initialOwner)
    {
        baseMetadataURI = initialBaseURI;
        emit BaseURISet(initialBaseURI);
    }

    function setRegistrar(address nextRegistrar) external onlyOwner {
        if (nextRegistrar == address(0)) revert InvalidRegistrar();
        registrar = nextRegistrar;
        emit RegistrarSet(nextRegistrar);
    }

    function setBaseURI(string calldata nextBaseURI) external onlyOwner {
        baseMetadataURI = nextBaseURI;
        emit BaseURISet(nextBaseURI);
    }

    function baseURI() external view returns (string memory) {
        return baseMetadataURI;
    }

    function mintIdentity(
        address to,
        string calldata name_,
        uint8 originRank,
        uint256 keyBond,
        address originWallet,
        bytes32 originProofId
    ) external onlyRegistrar returns (uint256 tokenId) {
        if (to == address(0)) revert InvalidRecipient();
        if (nextTokenId > MAX_IDENTITIES) revert SupplySoldOut();
        _validateName(name_);

        bytes32 nameHash = keccak256(bytes(name_));
        if (tokenByNameHash[nameHash] != 0) revert NameTaken();

        tokenId = nextTokenId;
        nextTokenId += 1;

        identities[tokenId] = Identity({
            name: name_,
            originRank: originRank,
            keyBond: keyBond,
            originWallet: originWallet,
            originProofId: originProofId,
            melted: false
        });
        nameHashByTokenId[tokenId] = nameHash;
        tokenByNameHash[nameHash] = tokenId;

        _safeMint(to, tokenId);
        emit IdentityMinted(tokenId, to, name_, originRank, keyBond, originWallet, originProofId);
    }

    function meltIdentity(uint256 tokenId) external onlyRegistrar returns (uint256 keyBond, address previousOwner) {
        previousOwner = _ownerOf(tokenId);
        if (previousOwner == address(0)) revert NonexistentIdentity();

        Identity storage identity = identities[tokenId];
        identity.melted = true;
        keyBond = identity.keyBond;
        string memory name_ = identity.name;

        _burn(tokenId);
        emit IdentityMelted(tokenId, previousOwner, name_, keyBond);
    }

    function identityOf(uint256 tokenId) external view returns (Identity memory) {
        if (_ownerOf(tokenId) == address(0) && !identities[tokenId].melted) revert NonexistentIdentity();
        return identities[tokenId];
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf(tokenId) == address(0) && !identities[tokenId].melted) revert NonexistentIdentity();
        return string.concat(identities[tokenId].name, ".key");
    }

    function isNameAvailable(string calldata name_) external view returns (bool) {
        if (!_isValidName(name_)) return false;
        return tokenByNameHash[keccak256(bytes(name_))] == 0;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory metadataBaseURI = _baseURI();
        return bytes(metadataBaseURI).length > 0 ? string.concat(metadataBaseURI, tokenId.toString()) : "";
    }

    function _baseURI() internal view override returns (string memory) {
        return baseMetadataURI;
    }

    function _validateName(string calldata name_) internal pure {
        if (!_isValidName(name_)) revert InvalidName();
    }

    function _isValidName(string calldata name_) internal pure returns (bool) {
        bytes calldata raw = bytes(name_);
        if (raw.length < MIN_NAME_LENGTH || raw.length > MAX_NAME_LENGTH) return false;
        for (uint256 i = 0; i < raw.length; i += 1) {
            bytes1 char = raw[i];
            if (char < 0x61 || char > 0x7a) return false;
        }
        return true;
    }
}
