# KEY Step 9 - Vercel Frontend Deploy

This step puts the React/Vite website online. The backend API still belongs on VPS.

## What Goes To Vercel

Vercel should contain only public frontend values:

- `VITE_BACKEND_URL`
- `VITE_CHAIN_ID`
- `VITE_MINT_GATE_ADDRESS`
- `VITE_KEY_TOKEN_ADDRESS`
- `VITE_TREASURY_VAULT_ADDRESS`
- `VITE_LP_RESERVE_ADDRESS`
- optional Uniswap display values

Never put these in Vercel:

- `MAINNET_PRIVATE_KEY`
- `SIGNER_PRIVATE_KEY`
- `SEPOLIA_PRIVATE_KEY`
- `SPHINCS_VERIFY_COMMAND`
- backend RPC secrets if they are private

## Mainnet Contract Values

```dotenv
VITE_CHAIN_ID=1
VITE_MINT_GATE_ADDRESS=0x0Aea11184B840554F648c7061a7E1D7594E17767
VITE_KEY_TOKEN_ADDRESS=0x75e463F6aDfB96Fbf2588e05aD73F87bC9126EB2
VITE_TREASURY_VAULT_ADDRESS=0xf8ef6D861996b75D6F286f5Fb1E1a81335F9038D
VITE_LP_RESERVE_ADDRESS=0x1f4CFF32ff21C942CB53955f0Db9A879f05239B6
VITE_UNISWAP_V4_POOL_ID=TBA
VITE_UNISWAP_V4_HOOK_ADDRESS=
```

Set this after the VPS backend has a domain:

```dotenv
VITE_BACKEND_URL=https://api.your-domain.com
```

If the backend is not ready yet, you can deploy the website first with a placeholder API URL, but minting will not work until this is changed and Vercel is redeployed.

## Vercel Dashboard Steps

1. Push this project to GitHub.
2. Open Vercel.
3. Click `Add New Project`.
4. Import the GitHub repo.
5. Use these settings:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

6. Add the `VITE_*` environment variables above.
7. Click `Deploy`.

## Local Check Before Deploy

If you have a local `.env.vercel`, run:

```powershell
npm run check:vercel
npm run build
```

The project also includes `vercel.json` so Vercel serves the Vite app correctly.

## After VPS Backend Is Ready

Go back to Vercel:

1. Project Settings.
2. Environment Variables.
3. Update `VITE_BACKEND_URL` to the real API domain.
4. Redeploy the latest production deployment.

Final shape:

```text
https://your-domain.com      -> Vercel frontend
https://api.your-domain.com  -> VPS backend
Ethereum mainnet             -> KEY contracts
```
