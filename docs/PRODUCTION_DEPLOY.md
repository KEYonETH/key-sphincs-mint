# KEY Production Deploy

This is the simple production checklist for the website and backend.

## 1. Prepare Environment

Copy the template:

```powershell
Copy-Item .env.production.example .env.production
```

Fill these values:

```dotenv
VITE_BACKEND_URL=https://api.your-domain.example
CORS_ORIGIN=https://your-domain.example
CHAIN_ID=1
VITE_CHAIN_ID=1
MINT_GATE_ADDRESS=0x...
VITE_MINT_GATE_ADDRESS=0x...
VITE_KEY_TOKEN_ADDRESS=0x...
VITE_TREASURY_VAULT_ADDRESS=0x...
VITE_LP_RESERVE_ADDRESS=0x...
SIGNER_PRIVATE_KEY=0x...
SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python backend/verifier/verify_sphincsminus.py {pubkey} {message_b64} {signature}
```

For Sepolia production rehearsal, use `CHAIN_ID=11155111`.

## 2. Check Config

```powershell
npm run check:production
```

Do not continue until this passes.

## 3. Build Frontend

```powershell
npm run build
```

Deploy the `dist/` folder to your frontend host.

## 4. Start Backend

On the server:

```powershell
npm install --omit=dev
npm run backend:production
```

For a real server, run it behind HTTPS using a reverse proxy such as Nginx or Caddy.
For a backend that stays alive after the terminal closes, use the PM2 guide:

```text
docs/SERVER_DEPLOY_PM2.md
```

Backend health URL:

```text
https://api.your-domain.example/api/status
```

## 5. Proof Backup

Proofs are stored in:

```text
backend/data/proofs.jsonl
```

Back up the proof log:

```powershell
npm run backup:proofs
```

Export a JSON snapshot:

```powershell
npm run export:proofs
```

## 6. Production Safety Rules

- Never expose `SIGNER_PRIVATE_KEY` in frontend code.
- Keep `SPHINCS_VERIFY_MODE=command`.
- Keep `CORS_ORIGIN` locked to your real frontend domain.
- Use HTTPS for frontend and backend.
- Back up `backend/data/proofs.jsonl`.
- Use separate wallets for deployer, backend signer, treasury, LP reserve, and owner.
