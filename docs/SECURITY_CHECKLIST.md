# Security Checklist

## Backend

- Use production `SPHINCS_VERIFY_MODE=command`.
- Do not expose `SIGNER_PRIVATE_KEY`.
- Use a fresh signer only for KEY attestations.
- Keep backend behind HTTPS.
- Add logs and alerting for failed attestations.
- Export proofs daily or per mint epoch.
- Run `npm run check:mainnet` before mainnet deployment.
- Backend signer must be separate from deployer, owner, treasury, and LP reserve.
- Current assisted SPHINCS flow is acceptable for beta, but browser/local SPHINCS signing is preferred before mainnet.

## Contracts

- Test wrong reward amount revert.
- Test reused proof revert.
- Test reused public key hash revert.
- Test wallet cap revert.
- Test public mint pool cap revert.
- Test expired attestation revert.
- Test signer rotation if used.
- Test treasury fee routing.

## Treasury / LP

- Use a multisig.
- Publish LP reserve wallet.
- Publish LP seed transaction.
- Lock liquidity or publish custody policy.
- Do not use an unaudited hook for mainnet launch.
- If the team can remove LP, state that clearly on the website.
- Do not advertise locked liquidity unless a real locker/timelock enforces it.

## Website

- Show real contract addresses.
- Show backend verifier mode.
- Show proof snapshot link.
- Explain exactly what is automated and what is manual.
- Show LP manager, pool ID, hook address if used, and liquidity policy before mainnet marketing.
