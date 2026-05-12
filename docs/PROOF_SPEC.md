# KEY Proof Specification

## Canonical message

The wallet signs this exact message:

```text
KEY Signature Mint
wallet=<recipient>
publicKeyHash=<publicKeyHash>
epoch=<epoch>
chainId=<chainId>
purpose=Proof-of-Signature Hash
```

## Required backend input

Preview mode:

```json
{
  "recipient": "0x...",
  "publicKeyHash": "0x...bytes32",
  "walletSignature": "0x...",
  "epoch": 123,
  "chainId": 1,
  "verifyingContract": "0xMintGate"
}
```

Production command mode additionally requires:

```json
{
  "sphincsPublicKey": "0x...",
  "sphincsSignature": "0x...",
  "sphincsMessage": "..."
}
```

## Hashes

```text
signatureHash = keccak256(sphincsSignature || walletSignature in preview)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
proofId = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)
```

## Tier selection

```text
roll = uint256(rewardHash) % 10000
0..9       Genesis Key   21,000 KEY
10..99     Quantum Key    5,000 KEY
100..499   Golden Key     1,500 KEY
500..1999  Clean Key        750 KEY
2000..9999 Normal Key       500 KEY
```

## EIP-712 attestation

Domain:

```json
{
  "name": "KEYMintGate",
  "version": "1",
  "chainId": 1,
  "verifyingContract": "0xMintGate"
}
```

Type:

```solidity
MintAttestation(
  address recipient,
  bytes32 publicKeyHash,
  bytes32 signatureHash,
  bytes32 rewardHash,
  uint256 rewardAmount,
  uint256 epoch,
  uint256 deadline
)
```

## Public records

The backend stores all proofs in `backend/data/proofs.jsonl` and can export `backend/data/snapshot.json`.
