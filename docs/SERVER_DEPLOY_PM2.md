# KEY Backend 24/7 Server Guide

This is Step 6: make the backend run like a real production service.

## What This Step Does

The backend must stay online because it:

- verifies the SPHINCS proof,
- creates the EIP-712 mint attestation,
- writes proof records to `backend/data/proofs.jsonl`,
- serves `/api/status`, `/api/proofs`, and mint endpoints.

PM2 keeps `backend/server.js` alive even if the terminal closes or the process crashes.

## 1. Prepare The Server

Install Node.js LTS on the server, then clone or upload this project.

```powershell
cd C:\path\to\key
npm install
```

For Linux:

```bash
cd /var/www/key
npm install
```

## 2. Create Production Env

Copy the template:

```powershell
Copy-Item .env.production.example .env.production
```

Fill `.env.production` with your deployed contract addresses and real domain:

```dotenv
VITE_BACKEND_URL=https://api.your-domain.com
CORS_ORIGIN=https://your-domain.com
CHAIN_ID=1
VITE_CHAIN_ID=1
MINT_GATE_ADDRESS=0x...
VITE_MINT_GATE_ADDRESS=0x...
VITE_KEY_TOKEN_ADDRESS=0x...
VITE_TREASURY_VAULT_ADDRESS=0x...
SIGNER_PRIVATE_KEY=0x...
SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python backend/verifier/verify_sphincsminus.py {pubkey} {message_b64} {signature}
```

Use `CHAIN_ID=11155111` only for Sepolia rehearsal.

## 3. Check Config

```powershell
npm run check:production
```

Do not start production until this passes.

## 4. Install PM2

```powershell
npm install -g pm2
```

Start the backend:

```powershell
npm run pm2:start
```

Useful commands:

```powershell
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

## 5. Check Backend Health

If the backend is local:

```powershell
Invoke-RestMethod http://localhost:8787/api/status
```

Or use the project health script:

```powershell
npm run backend:health
```

Expected result:

```text
Production health check passed.
```

## 6. Put HTTPS In Front

The backend should not be exposed as plain HTTP on mainnet.

Simple production shape:

```text
User browser
  -> https://your-domain.com
  -> https://api.your-domain.com
  -> localhost:8787 backend
```

Use Nginx, Caddy, Cloudflare Tunnel, Railway, Render, Fly.io, or another host that gives HTTPS.

## 7. Back Up Proofs

The proof file is important:

```text
backend/data/proofs.jsonl
```

Back it up:

```powershell
npm run backup:proofs
npm run export:proofs
```

For mainnet, publish proof snapshots regularly to IPFS, Arweave, GitHub Releases, or a public storage bucket.

## Beginner Notes

- `SIGNER_PRIVATE_KEY` is the backend signer wallet. Never put it in frontend code.
- `MAINNET_PRIVATE_KEY` is only for contract deployment. Do not use the same wallet for every role.
- `CONTRACT_OWNER_ADDRESS`, treasury, and LP reserve should be multisig wallets for mainnet.
- The current SPHINCS public flow is backend-assisted. For a trust-minimized mainnet, move SPHINCS key generation/signing into the browser or a user-local signer before launch.
