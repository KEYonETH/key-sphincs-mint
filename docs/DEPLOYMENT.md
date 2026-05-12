# KEY Deployment Guide

## Local frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Local backend

```bash
cp .env.example .env
npm run backend
```

Open `http://localhost:8787/api/status`.

## Contract deployment order

1. Prepare multisig addresses:
   - treasury owner;
   - LP reserve recipient or timelock;
   - treasury reserve recipient;
   - backend attestation signer.
2. Deploy `KEYTreasuryVault(initialOwner)`.
3. Deploy `KEYToken(lpReserveRecipient, treasuryReserveRecipient)`.
4. Deploy `KEYMintGate(KEYToken, KEYTreasuryVault, attestationSigner)`.
5. Call `KEYToken.setMintGate(KEYMintGate)`.
6. Call `KEYTreasuryVault.setMintGate(KEYMintGate)`.
7. Verify all contracts on Etherscan.
8. Update website `.env` addresses.
9. Switch backend to production SPHINCS verification.
10. Seed Uniswap liquidity with LP reserve and treasury ETH route.
11. Publish LP proof and proof snapshot.
12. Audit before mainnet launch.

## Mainnet readiness checklist

- [ ] Contracts compile and tests pass.
- [ ] Mint tier tests pass for all reward brackets.
- [ ] Attestation signer test passes.
- [ ] Wrong reward amount reverts.
- [ ] Reused public key hash reverts.
- [ ] Wallet cap reverts after 3 mints.
- [ ] Treasury receives exact ETH fee.
- [ ] Proof export works.
- [ ] Website displays real addresses.
- [ ] Liquidity route is published.
- [ ] Admin ownership moved to multisig or renounced where safe.
