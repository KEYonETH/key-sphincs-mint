# KEY — SPHINCS Signature Minting

## 1. Abstract

KEY is an Ethereum ERC20 mint experiment inspired by hash-based post-quantum signatures. It uses a mechanism called **Proof-of-Signature Hash**.

The user creates a fresh key context, signs a deterministic mint message, reveals a reward tier from the resulting signature hash, and mints the approved KEY amount. KEY is not a browser proof-of-work miner and not a fixed-amount claim.

## 2. Reference idea

The technical reference is the SPHINCS-style flow: key generation, public key derivation, signing, and verification. KEY uses that idea as a narrative and mechanism reference, but changes the token design into a tiered mint where the signature hash decides the reward.

## 3. Why off-chain verification

Post-quantum hash signatures can be large and expensive to verify directly on Ethereum. KEY uses a verifier backend that checks the signature and then signs a compact EIP-712 attestation. The smart contract verifies the EIP-712 signer, recomputes the reward tier, enforces caps, and mints KEY.

## 4. Mint lifecycle

1. User connects wallet.
2. User generates a fresh SPHINCS-style public key hash.
3. User signs the canonical mint message.
4. Backend verifies wallet ownership.
5. Production backend verifies the SPHINCS signature using the configured verifier command.
6. Backend computes `signatureHash`, `rewardHash`, `proofId`, and reward tier.
7. Backend signs an EIP-712 mint attestation.
8. User submits the attestation to `KEYMintGate` with 0.001 ETH.
9. Contract recomputes the tier and rejects wrong reward amounts.
10. Contract sends ETH to `KEYTreasuryVault` and mints KEY to the user.

## 5. Core formula

```text
signatureHash = keccak256(signature)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
proofId = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)
roll = uint256(rewardHash) % 10000
```

## 6. Reward tiers

| Tier | Reward | Odds | Roll range |
|---|---:|---:|---:|
| Genesis Key | 21,000 KEY | 0.1% | 0–9 |
| Quantum Key | 5,000 KEY | 0.9% | 10–99 |
| Golden Key | 1,500 KEY | 4% | 100–499 |
| Clean Key | 750 KEY | 15% | 500–1,999 |
| Normal Key | 500 KEY | 80% | 2,000–9,999 |

Average reward is approximately 638.5 KEY per mint. With a 10,000,000 KEY public mint pool, the estimated successful mint count is about 15,600.

## 7. Tokenomics

| Item | Amount |
|---|---:|
| Max supply | 21,000,000 KEY |
| Public mint pool | 10,000,000 KEY |
| LP reserve | 10,000,000 KEY |
| Treasury reserve | 1,000,000 KEY |
| Mint price | 0.001 ETH |
| Wallet cap | 1 successful mint |

## 8. Contract-level fairness

The backend cannot choose arbitrary rewards because `KEYMintGate` recomputes:

```text
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
rewardAmount = rewardForHash(rewardHash)
```

If the backend signs an attestation with a wrong reward amount, the mint reverts.

The contract also rejects:

- used proof IDs;
- reused public key hashes;
- wrong mint price;
- expired attestation;
- wallet cap overflow;
- public mint pool overflow;
- invalid attestation signer.

## 9. Proof transparency

Each proof record should be public:

```json
{
  "recipient": "0x...",
  "publicKeyHash": "0x...",
  "signatureHash": "0x...",
  "rewardHash": "0x...",
  "proofId": "0x...",
  "tier": "Golden Key",
  "reward": "1500 KEY",
  "epoch": 123,
  "chainId": 1,
  "attestation": "0x..."
}
```

The backend stores `proofs.jsonl` and can export `snapshot.json`. For mainnet, publish snapshots to IPFS/Arweave and link them from the website.

## 10. Vault and liquidity route

The mint fee flows into `KEYTreasuryVault`. The vault can route ETH to a configured liquidity manager after deployment. The LP reserve is 10,000,000 KEY and should be used for fair liquidity creation and/or locked liquidity.

For Uniswap v4, hooks are optional pool contracts specified at pool creation. KEY should publish the pool ID, hook address, source code, LP transaction, lock proof, and custody details.

## 11. Trust model

| Component | Trust assumption | Mitigation |
|---|---|---|
| Frontend | User sees exact message and key hash | Open source frontend and static deploy |
| Backend | Verifies signature correctly | Publish proof records and external verifier command |
| Attestation signer | Signs only valid proofs | Hardware wallet / secure server / rotation procedure |
| Mint contract | Enforces price, cap, tier, proof reuse | Verify source and audit |
| Treasury vault | Routes ETH and LP transparently | Multisig + event logs + public route page |

## 12. Mainnet warning

The included frontend preview mode is for development only. Before launch, enable production SPHINCS verification, audit contracts, publish addresses, and verify all source code.
