# KEYSPACE Final Rules

## MintGate

- Ten mints per wallet.
- Ten valid mint proofs unlock one KEY Card NFT / `.key` identity claim.
- The identity uses the best Key Rank from those ten mints.
- Mint price remains 0.001 ETH.
- The current deployed mainnet `KEYMintGate` address cannot be changed or deleted in place. The 10-mint rule requires a replacement mint gate such as `KEYMintGateV3`.

## Registrar

- Origin claim opens after mint-out by admin or state flag.
- There is no tier-by-day claiming schedule.
- All eligible minters can claim when KEYSPACE opens.
- Rank validates minimum name length:
  - Genesis: 3+ letters
  - Quantum: 4+ letters
  - Golden: 5+ letters
  - Clean: 6+ letters
  - Normal: 7+ letters
- Names must match `^[a-z]+$`.
- Names may use lowercase English letters only: `a-z`.
- Numbers, spaces, symbols, hyphens, underscores, and uppercase letters are not valid.
- Recommended maximum length: 16 letters.
- Each wallet can use one ten-proof Origin Claim batch once.
- Each mint proof inside that batch can only be used once.
- The KeyBond is the combined KEY reward amount from all ten mint proofs.
- A claimed identity becomes an ERC721-style asset and can be transferred or traded.

## Identity NFT

- `KEYIdentity` is the ERC721 layer for `.key` names.
- Maximum supply is 21,000 identities.
- Minting is restricted to the configured registrar.
- Melting/burning is restricted to the configured registrar.
- Names are stored without the `.key` suffix and displayed as `name.key`.
- Names are reserved after minting, including after melt, unless a future governance decision explicitly changes name reuse rules before deployment.
- Identity metadata stores name, Origin Rank, KeyBond amount, origin wallet, and origin proof ID.
- OpenSea can display KEYSPACE identities as ERC721 assets through `tokenURI` metadata.
- KEYSPACE Market primary listings use native ETH. The KEY reward remains locked as KeyBond inside the identity.
- OpenSea ETH listings are separate owner-signed marketplace orders and cannot be forced by the NFT contract to track KEY price in real time.
- `KEYIdentity.tokenURI(tokenId)` should resolve to `API_BASE_URL + "/api/keyspace/metadata/" + tokenId`, for example `https://api.key-sphincs.xyz/api/keyspace/metadata/421`.
- Wallets and OpenSea read that metadata JSON, then fetch the SVG card image from `API_BASE_URL + "/api/keyspace/image/" + tokenId + ".svg"`.

## Backend

- Backend only indexes data.
- Backend does not create identities.
- Backend does not run trading.
- Backend does not transfer KEY or NFTs.
- Backend helps read status, wallet rank, listings, sales, and metadata.
- Backend may expose KEYBond-to-ETH reference quotes for UI display, but these are estimates unless a live oracle/liquid market is configured.
