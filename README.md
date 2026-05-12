# KEY - SPHINCS Signature Mint

KEY is a React/Vite frontend plus Node/Express attestation backend for a Proof-of-Signature Hash mint flow.

Wallet proves who you are. SPHINCS proves your key. The signature hash decides your reward.

## Preview Mode

Preview mode keeps the simple local demo working. It verifies your MetaMask signature, then uses that signature as the simulated proof source.

```powershell
npm install
Copy-Item .env.example .env
npm run backend
```

In another terminal:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173/#/mint
```

Backend status:

```text
http://localhost:8787/api/status
```

## Real SPHINCS Mode

Clone and test the SPHINCS reference implementation:

```powershell
mkdir backend\vendor
git clone https://github.com/vbuterin/sphincsminus.git backend\vendor\sphincsminus
cd backend\vendor\sphincsminus
python sphincs_minus.py test
python sphincs_minus.py keygen
```

Keep the generated private key and public key. Paste only the public key into the UI.

## Public Mint Flow

1. Open `http://localhost:5173/#/mint`.
2. Click `Generate key`.
3. Click `Sign address`.
4. Approve the MetaMask message.
5. Click `Mint KEY`.
6. Confirm the transaction.

In command mode, the backend-assisted flow creates a fresh single-use SPHINCS key, signs the canonical message, verifies the signature, deletes the temporary private key from memory, signs the attestation, and sends the mint transaction through the frontend.

The canonical message format is:

```text
KEY Signature Mint
wallet=<wallet>
publicKeyHash=<publicKeyHash>
epoch=<epoch>
chainId=<chainId>
purpose=Proof-of-Signature Hash
```

## Save And Sign Canonical Message

Create `backend\data\message.txt` and paste the canonical message, or use the UI `copy command` button.

Manual PowerShell flow:

```powershell
$message = Get-Content .\backend\data\message.txt -Raw
$messageB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($message))
python .\backend\verifier\sign_sphincsminus.py 0xPRIVATEKEY $messageB64 .\backend\data\key_sig.bin
```

Convert `sig.bin` to hex:

```powershell
$bytes = [System.IO.File]::ReadAllBytes(".\backend\data\key_sig.bin")
$sigHex = "0x" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
$sigHex | Set-Clipboard
$sigHex
```

Paste the signature hex into the UI.

## Switch Backend To Command Mode

Edit `.env`:

```dotenv
SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python backend/verifier/verify_sphincsminus.py {pubkey} {message_b64} {signature}
```

If your Windows Python launcher is `py`:

```dotenv
SPHINCS_VERIFY_COMMAND=py backend/verifier/verify_sphincsminus.py {pubkey} {message_b64} {signature}
```

Restart backend:

```powershell
npm run backend
```

Then click `3 Mint` in the UI. Expected result: backend verifies the real SPHINCS signature, reveals the reward tier, and returns the mint attestation.

## Helper Commands

```powershell
python .\backend\vendor\sphincsminus\sphincs_minus.py keygen
python .\backend\vendor\sphincsminus\sphincs_minus.py sign 0xPRIVATEKEY "hello world" .\backend\data\sig.bin
python .\backend\vendor\sphincsminus\sphincs_minus.py verify 0xPUBLICKEY "hello world" .\backend\data\sig.bin
```

## Backend Files

- `backend/server.js` - API server
- `backend/lib/config.js` - tokenomics and backend config
- `backend/lib/attestation.js` - EIP-712 mint attestation logic
- `backend/lib/sphincsVerifier.js` - wallet ownership and SPHINCS verification adapter
- `backend/lib/store.js` - JSONL proof storage
- `backend/lib/challengeStore.js` - issued challenge lifecycle
- `backend/verifier/verify_sphincsminus.py` - command-mode verifier wrapper
- `backend/verifier/sign_sphincsminus.py` - local signing helper
- `backend/data/proofs.jsonl` - local proof log

## Proof Explorer

Open:

```text
http://localhost:5173/#/proof
```

The page reads real proof records from:

```text
http://localhost:8787/api/proofs
```

Each proof shows the wallet, tier, reward, public key hash, signature hash, reward hash, proof ID, epoch, attestation signer, and SPHINCS verification result.

## Step 3 - Mainnet Config Preparation

Do not deploy mainnet from `.env` used for Sepolia testing. Use the dedicated template:

```powershell
Copy-Item .env.mainnet.example .env.mainnet
```

Fill these with production values:

```dotenv
MAINNET_RPC_URL=
MAINNET_PRIVATE_KEY=
MAINNET_DEPLOY_CONFIRM=DEPLOY_KEY_MAINNET

CONTRACT_OWNER_ADDRESS=
LP_RESERVE_RECIPIENT=
TREASURY_RESERVE_RECIPIENT=
BACKEND_SIGNER_ADDRESS=
SIGNER_PRIVATE_KEY=
```

Mainnet custody should be separated:

- `MAINNET_PRIVATE_KEY` deploys contracts and pays gas.
- `CONTRACT_OWNER_ADDRESS` should be a multisig or hardware-secured owner.
- `LP_RESERVE_RECIPIENT` receives the 10M KEY liquidity reserve.
- `TREASURY_RESERVE_RECIPIENT` receives the 1M KEY operations reserve.
- `BACKEND_SIGNER_ADDRESS` must match `SIGNER_PRIVATE_KEY`.

The mainnet deploy script refuses to run unless:

- the Hardhat network is Ethereum mainnet chain ID `1`;
- `MAINNET_DEPLOY_CONFIRM=DEPLOY_KEY_MAINNET`;
- production addresses are valid;
- production custody addresses are not the deployer wallet;
- `BACKEND_SIGNER_ADDRESS` matches `SIGNER_PRIVATE_KEY`.

Mainnet deploy command:

```powershell
npm run contracts:deploy:mainnet
```

After deployment, copy the printed addresses into production backend and frontend environment variables:

```dotenv
CHAIN_ID=1
VITE_CHAIN_ID=1
MINT_GATE_ADDRESS=0x...
VITE_MINT_GATE_ADDRESS=0x...
VITE_KEY_TOKEN_ADDRESS=0x...
VITE_TREASURY_VAULT_ADDRESS=0x...
VITE_LP_RESERVE_ADDRESS=0x...
SPHINCS_VERIFY_MODE=command
```

## Step 4 - Sepolia Final Check And Verification

Before mainnet, run the local Sepolia consistency check:

```powershell
npm run check:sepolia
```

This checks:

- Sepolia RPC chain ID is `11155111`.
- token, vault, and mint gate addresses have bytecode.
- frontend and backend mint gate addresses match.
- mint gate points to the configured token and vault.
- backend `SIGNER_PRIVATE_KEY` matches the mint gate attestation signer.

To verify contracts on Sepolia Etherscan, add an API key:

```dotenv
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Then run:

```powershell
npm run contracts:verify:sepolia
```

For mainnet after deployment:

```powershell
npm run contracts:verify:mainnet
```

The verify script uses constructor arguments from `.env` for Sepolia and `.env.mainnet` for mainnet.

## Step 5 - Production Backend And Frontend Prep

Use the production template:

```powershell
Copy-Item .env.production.example .env.production
```

Check it:

```powershell
npm run check:production
```

Build the frontend:

```powershell
npm run build
```

Start the backend with production env:

```powershell
npm run backend:production
```

Full deployment notes are in:

```text
docs/PRODUCTION_DEPLOY.md
```

## Step 6 - Run Backend 24/7

For a real website, the backend cannot depend on an open terminal. Use PM2 so the backend keeps running:

```powershell
npm install -g pm2
npm run check:production
npm run pm2:start
npm run pm2:logs
```

Check the backend:

```powershell
npm run backend:health
```

Full beginner guide:

```text
docs/SERVER_DEPLOY_PM2.md
```

Mainnet note: the current simple SPHINCS flow is backend-assisted. Before Ethereum mainnet, move SPHINCS key generation/signing to browser/WASM or a local signer so the server does not create the user's SPHINCS private key.

## Step 7 - Mainnet Readiness Gate

Before VPS, Vercel, or real Ethereum deployment, create `.env.mainnet` and run:

```powershell
Copy-Item .env.mainnet.example .env.mainnet
npm run check:mainnet
```

This checks mainnet RPC, deploy confirmation, signer wallets, custody addresses, Etherscan key, and SPHINCS command mode.

Full beginner guide:

```text
docs/MAINNET_READINESS.md
```

VPS and Vercel come after this gate:

1. Pass `npm run check:mainnet`.
2. Deploy real KEY contracts.
3. Verify contracts.
4. Put frontend on Vercel.
5. Put backend on VPS.
6. Create the Uniswap v4 pool.

## Step 8 - Vercel Frontend

The frontend can be deployed on Vercel. Only public `VITE_*` variables go there:

```text
docs/VERCEL_FRONTEND_DEPLOY.md
```

Check locally:

```powershell
npm run check:vercel
npm run build
```

Minting needs a real backend API URL, so after the VPS backend is online, update `VITE_BACKEND_URL` in Vercel and redeploy.

## Before Mainnet

1. Finish Sepolia testing with multiple wallets.
2. Keep `SPHINCS_VERIFY_MODE=command`.
3. Use a dedicated backend signer.
4. Use multisig/hardware custody for owner, LP reserve, and treasury.
5. Deploy with `scripts/deploy-mainnet.js`.
6. Verify contracts on Etherscan.
7. Audit contracts and backend verifier flow.
8. Publish proof snapshots and liquidity/treasury actions.
