# Backend Production Upgrade Guide

## Modes

### Preview mode

Used for UI development.

```env
SPHINCS_VERIFY_MODE=preview
```

This verifies wallet ownership but does not verify a real SPHINCS signature.

### Command mode

Used for production.

```env
SPHINCS_VERIFY_MODE=command
SPHINCS_VERIFY_COMMAND=python3 /absolute/path/to/verify_sphincs.py --pubkey {pubkey} --message-b64 {message_b64} --signature {signature}
```

The command must print `ok`, `valid`, or `true` when a proof is valid.

## Required production work

1. Clone your chosen SPHINCS verifier implementation.
2. Write a small wrapper script that accepts public key, message, and signature.
3. Test the wrapper locally with known valid/invalid signatures.
4. Set `SPHINCS_VERIFY_MODE=command`.
5. Start the backend.
6. Confirm `/api/status` returns `mode: command`.
7. Verify that invalid signatures are rejected.
8. Export proof batches regularly and publish them.

## Security checklist

- Run backend behind HTTPS.
- Keep `SIGNER_PRIVATE_KEY` in a secure key manager where possible.
- Use a fresh attestation signer, not a personal wallet.
- Rate-limit `/api/attest`.
- Monitor repeated failures by wallet/IP.
- Publish all proof snapshots.
- Rotate signer only through public announcement and contract event.
