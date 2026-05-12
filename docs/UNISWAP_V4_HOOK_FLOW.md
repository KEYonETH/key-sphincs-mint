# KEY Uniswap v4 Liquidity / Hook Flow

## Goal

Mint ETH should be transparent. The user pays 0.001 ETH to mint. The fee goes to `KEYMintGate`, then to `KEYTreasuryVault`. The vault can route ETH to a public liquidity manager that seeds or supports liquidity with the LP reserve.

## Flow

```text
User pays 0.001 ETH
  -> KEYMintGate
  -> KEYTreasuryVault
  -> LiquidityManager / multisig route
  -> Uniswap v4 pool
  -> public pool id + hook + lock proof
```

## What to publish on the website

- KEY token address
- Mint gate address
- Treasury vault address
- LP reserve wallet/timelock address
- Uniswap v4 pool ID
- Hook contract address if used
- Initial LP transaction hash
- Liquidity lock proof
- Vault route transaction history

## Production hook note

The included `KEYUniswapV4HookConcept.sol` is a documentation placeholder only. A production v4 hook must be implemented against official Uniswap v4 interfaces and audited.

## Mainnet build order

Do not build the production hook before the token, mint gate, backend signer, and proof flow are stable on Sepolia.

Recommended order:

1. Finish Sepolia mint testing with real SPHINCS command mode.
2. Deploy mainnet `KEYToken`, `KEYTreasuryVault`, and `KEYMintGate`.
3. Verify all contracts on Etherscan.
4. Start the backend in production mode behind HTTPS.
5. Create a Uniswap v4 pool for `KEY / ETH`.
6. Add initial liquidity from the LP reserve wallet.
7. Publish the pool ID, hook address if used, LP transaction hash, and custody policy.
8. Build a production hook only after the pool flow is tested and audited.

## Admin and LP custody policy

The project can keep operational control through a treasury multisig or liquidity manager, but this must be public and explicit.

Acceptable production language:

- LP reserve is managed by the project multisig.
- The multisig can add, move, or remove liquidity for market operations.
- Any unlock or withdrawal action will be published with a transaction hash.
- The website shows the LP manager, pool ID, hook address, and liquidity route.

Avoid hidden control. A hook or vault that can silently remove user-facing liquidity without disclosure will look unsafe to users and auditors.

## What the hook should and should not do

Good hook goals:

- publish liquidity route events,
- enforce a transparent treasury or liquidity policy,
- collect or route approved fees if the mechanism is documented,
- expose public state that the website can display.

Avoid for v1 mainnet:

- unaudited custom swap taxes,
- hidden owner-only withdrawal behavior,
- complex automatic liquidity logic before the normal pool works,
- anything that changes user swaps in a surprising way.

## Official references

- Uniswap v4 hooks concept: https://developers.uniswap.org/docs/get-started/concepts/hooks
- Uniswap v4 create pool guide: https://developers.uniswap.org/contracts/v4/quickstart/create-pool
- Uniswap v4 liquidity hooks guide: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/liquidity-hooks
