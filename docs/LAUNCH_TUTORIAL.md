# KEY Launch Tutorial

## Phase 1 — Local preview

```bash
cd key-signature-production-upgrade
npm install
cp .env.example .env
npm run backend
npm run dev
```

Open the website, connect wallet, generate key, sign address, reveal tier.

## Phase 2 — Replace preview verifier

1. Choose the SPHINCS implementation you will use.
2. Create a wrapper script that receives `--pubkey`, `--message-b64`, and `--signature`.
3. The wrapper should print `ok` only when the proof is valid.
4. Set:

```env
SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python3 /absolute/path/to/verify_sphincs.py --pubkey {pubkey} --message-b64 {message_b64} --signature {signature}
```

5. Restart backend.
6. Test one valid signature and one invalid signature.

## Phase 3 — Deploy contracts

Deploy in this order:

1. `KEYTreasuryVault(multisigOwner)`
2. `KEYToken(lpReserveRecipient, treasuryReserveRecipient)`
3. `KEYMintGate(KEYToken, KEYTreasuryVault, attestationSigner)`
4. `KEYToken.setMintGate(KEYMintGate)`
5. `KEYTreasuryVault.setMintGate(KEYMintGate)`
6. Verify all sources on Etherscan.

## Phase 4 — Configure website/backend

Update `.env`:

```env
VITE_KEY_TOKEN_ADDRESS=0x...
VITE_MINT_GATE_ADDRESS=0x...
VITE_TREASURY_VAULT_ADDRESS=0x...
VITE_LP_RESERVE_ADDRESS=0x...
MINT_GATE_ADDRESS=0x...
SIGNER_PRIVATE_KEY=0x...
CHAIN_ID=1
```

Restart frontend and backend.

## Phase 5 — Liquidity

1. Use the 10,000,000 KEY LP reserve for pool creation.
2. Use public treasury ETH route to seed liquidity.
3. Publish transaction hashes.
4. Publish pool ID and hook address if used.
5. Lock liquidity or clearly publish custody/multisig terms.

## Phase 6 — Public transparency

Publish on the website:

- contract addresses;
- Etherscan verified links;
- proof snapshot;
- LP transaction;
- liquidity lock proof;
- multisig owner;
- attestation signer address.

## Phase 7 — Launch checklist

- [ ] Backend in `command` mode.
- [ ] Invalid SPHINCS signatures rejected.
- [ ] Contract reward recomputation tested.
- [ ] Wallet cap tested.
- [ ] Public key reuse tested.
- [ ] Treasury receives mint fee.
- [ ] Proof export works.
- [ ] Website shows real addresses.
- [ ] Liquidity route published.
- [ ] Contracts audited or at least reviewed by a Solidity dev.
