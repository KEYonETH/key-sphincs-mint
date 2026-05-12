# KEY Step 7 - Mainnet Readiness

Step 7 is the safety gate before VPS, Vercel, and real Ethereum mainnet deployment.

## Simple Meaning

Before mainnet, make sure:

- Sepolia mint flow works with real SPHINCS command mode.
- Contracts are verified on Sepolia.
- Backend signer is separate from deployer and treasury wallets.
- Owner, treasury, and LP reserve are controlled deliberately.
- Backend will run behind HTTPS.
- The website will use mainnet addresses only after mainnet deploy.

## Wallet Roles

Do not use one private key for everything on mainnet.

Recommended roles:

| Role | What it does | Should it be private key on server? |
| --- | --- | --- |
| `MAINNET_PRIVATE_KEY` | deploys contracts once | no, keep local/hardware if possible |
| `SIGNER_PRIVATE_KEY` | backend signs mint attestations | yes, only on VPS backend |
| `CONTRACT_OWNER_ADDRESS` | owns token/gate admin | no, use multisig |
| `LP_RESERVE_RECIPIENT` | receives 10M LP reserve KEY | no, use multisig/timelock |
| `TREASURY_RESERVE_RECIPIENT` | receives 1M treasury KEY | no, use multisig |

For Sepolia testing, using the same wallet is okay. For mainnet, separate them.

## Create Mainnet Env

```powershell
Copy-Item .env.mainnet.example .env.mainnet
```

Fill these fields:

```dotenv
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/...
MAINNET_PRIVATE_KEY=0x...
MAINNET_DEPLOY_CONFIRM=DEPLOY_KEY_MAINNET
ETHERSCAN_API_KEY=...

SIGNER_PRIVATE_KEY=0x...
BACKEND_SIGNER_ADDRESS=0x...

CONTRACT_OWNER_ADDRESS=0x...
LP_RESERVE_RECIPIENT=0x...
TREASURY_RESERVE_RECIPIENT=0x...

SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python backend/verifier/verify_sphincsminus.py {pubkey} {message_b64} {signature}
```

## Run The Check

```powershell
npm run check:mainnet
```

If it fails, fix the listed items before continuing.

## Where VPS And Vercel Fit

Use this order:

1. Step 7: pass `npm run check:mainnet` locally.
2. Step 8: deploy real KEY contracts to Ethereum mainnet.
3. Step 9: verify contracts on Etherscan.
4. Step 10: put backend on VPS with `.env.production`.
5. Step 11: put frontend on Vercel with mainnet `VITE_*` variables.
6. Step 12: create Uniswap v4 pool and publish LP details.

Do not move to VPS/Vercel before the mainnet contract addresses exist, because the frontend and backend need those addresses.

## Uniswap v4 Reminder

The real KEY token is created in Step 8. The Uniswap v4 pool comes after that, because a pool needs the real token address.

If the project keeps LP control, say it clearly:

- LP reserve is controlled by the project multisig.
- Liquidity may be added, moved, or removed for operations.
- All LP actions should be published with transaction hashes.

Do not claim liquidity is locked unless it is actually locked by a contract or locker.
