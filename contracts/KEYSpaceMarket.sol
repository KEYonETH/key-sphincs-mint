// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title KEYSPACE Market
/// @notice Native KEY marketplace for KEYSPACE .key identity NFTs.
contract KEYSpaceMarket is Ownable {
    struct Listing {
        address seller;
        uint256 price;
    }

    IERC20 public immutable keyToken;
    IERC721 public immutable identity;

    bool public marketOpen;
    uint16 public feeBps;
    address public feeRecipient;
    bool private locked;

    mapping(uint256 => Listing) public listings;

    event MarketOpenSet(bool open);
    event FeeSet(uint16 feeBps, address indexed feeRecipient);
    event IdentityListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event IdentityListingCancelled(uint256 indexed tokenId, address indexed seller);
    event IdentitySold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    error MarketClosed();
    error InvalidAddress();
    error InvalidPrice();
    error InvalidFee();
    error NotIdentityOwner();
    error NotApproved();
    error NotListed();
    error NotSellerOrOwner();
    error SellerNoLongerOwner();
    error TransferFailed();
    error Locked();

    modifier nonReentrant() {
        if (locked) revert Locked();
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialOwner, address keyToken_, address identity_) Ownable(initialOwner) {
        if (keyToken_ == address(0) || identity_ == address(0)) revert InvalidAddress();
        keyToken = IERC20(keyToken_);
        identity = IERC721(identity_);
        feeRecipient = initialOwner;
    }

    function setMarketOpen(bool open) external onlyOwner {
        marketOpen = open;
        emit MarketOpenSet(open);
    }

    function setFee(uint16 nextFeeBps, address nextFeeRecipient) external onlyOwner {
        if (nextFeeBps > 1_000) revert InvalidFee();
        if (nextFeeBps > 0 && nextFeeRecipient == address(0)) revert InvalidAddress();
        feeBps = nextFeeBps;
        feeRecipient = nextFeeRecipient;
        emit FeeSet(nextFeeBps, nextFeeRecipient);
    }

    function listIdentity(uint256 tokenId, uint256 price) external {
        if (!marketOpen) revert MarketClosed();
        if (price == 0) revert InvalidPrice();
        if (identity.ownerOf(tokenId) != msg.sender) revert NotIdentityOwner();
        if (!_isApproved(tokenId, msg.sender)) revert NotApproved();

        listings[tokenId] = Listing({seller: msg.sender, price: price});
        emit IdentityListed(tokenId, msg.sender, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();

        address currentOwner = identity.ownerOf(tokenId);
        if (msg.sender != listing.seller && msg.sender != currentOwner) revert NotSellerOrOwner();

        delete listings[tokenId];
        emit IdentityListingCancelled(tokenId, listing.seller);
    }

    function buyIdentity(uint256 tokenId) external nonReentrant {
        if (!marketOpen) revert MarketClosed();

        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();
        if (identity.ownerOf(tokenId) != listing.seller) revert SellerNoLongerOwner();
        if (!_isApproved(tokenId, listing.seller)) revert NotApproved();

        delete listings[tokenId];

        uint256 fee = (listing.price * feeBps) / 10_000;
        uint256 sellerProceeds = listing.price - fee;

        if (!keyToken.transferFrom(msg.sender, listing.seller, sellerProceeds)) revert TransferFailed();
        if (fee > 0 && !keyToken.transferFrom(msg.sender, feeRecipient, fee)) revert TransferFailed();

        identity.safeTransferFrom(listing.seller, msg.sender, tokenId);
        emit IdentitySold(tokenId, listing.seller, msg.sender, listing.price);
    }

    function getListing(uint256 tokenId) external view returns (address seller, uint256 price) {
        Listing memory listing = listings[tokenId];
        return (listing.seller, listing.price);
    }

    function _isApproved(uint256 tokenId, address owner) internal view returns (bool) {
        return identity.getApproved(tokenId) == address(this) || identity.isApprovedForAll(owner, address(this));
    }
}
