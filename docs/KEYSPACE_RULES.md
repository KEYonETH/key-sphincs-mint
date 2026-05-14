# KEYSPACE Final Rules

## MintGate

- One mint per wallet.
- One Key Rank per wallet.
- One non-transferable Origin Claim Right per minting wallet.
- Mint price remains 0.001 ETH.
- The current deployed mainnet `KEYMintGate` address cannot be changed in place. Full on-chain one-mint enforcement for a new gate requires a `KEYMintGateV2` deployment or equivalent replacement flow.

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
- One Origin Claim Right can only be used once.
- A claimed identity becomes an ERC721-style asset and can be transferred or traded.

## Identity NFT

- `KEYIdentity` is the ERC721 layer for `.key` names.
- Maximum supply is 21,000 identities.
- Minting is restricted to the configured registrar.
- Melting/burning is restricted to the configured registrar.
- Names are stored without the `.key` suffix and displayed as `name.key`.
- Names are reserved after minting, including after melt, unless a future governance decision explicitly changes name reuse rules before deployment.
- Identity metadata stores name, Origin Rank, KeyBond amount, origin wallet, and origin proof ID.

## Backend

- Backend only indexes data.
- Backend does not create identities.
- Backend does not run trading.
- Backend does not transfer KEY or NFTs.
- Backend helps read status, wallet rank, listings, sales, and metadata.
