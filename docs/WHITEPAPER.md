# KEY — SPHINCS Signature Minting

## 1. Abstract

KEY is an Ethereum ERC20 mint and ERC721 identity experiment inspired by hash-based post-quantum signatures. It uses a mechanism called **Proof-of-Signature Hash**.

The user creates a fresh key context, signs a deterministic mint message, reveals a reward tier from the resulting signature hash, and mints the approved KEY amount. After ten valid KEY mints, the wallet can claim one KEY Card NFT and `.key` identity backed by the combined KEY rewards from those ten mints. KEY is not a browser proof-of-work miner and not a fixed-amount claim.

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
8. User submits the attestation to the active `KEYMintGateV3` with 0.001 ETH.
9. Contract recomputes the tier and rejects wrong reward amounts.
10. Contract sends ETH to `KEYTreasuryVault` and mints KEY to the user.

## 5. KEY Card NFT lifecycle

1. A wallet can mint KEY up to ten times.
2. Each mint creates one unique public proof ID and one reward amount.
3. Ten valid minted proofs unlock one KEY Card NFT claim.
4. The wallet approves the combined KEY reward amount as KeyBond.
5. `KEYSpaceRegistrarV3` claims one ERC721 identity through `KEYIdentity`.
6. The identity rank is the best tier found across the ten mints.
7. The KeyBond amount is the sum of all ten KEY rewards.
8. The NFT can trade on the on-chain ETH-native `KEYSpaceMarket`.

## 6. Core formula

```text
signatureHash = keccak256(signature)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
proofId = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)
roll = uint256(rewardHash) % 10000
```

## 7. Reward tiers

| Tier | Reward | Odds | Roll range |
|---|---:|---:|---:|
| Genesis Key | 21,000 KEY | 0.1% | 0–9 |
| Quantum Key | 5,000 KEY | 0.9% | 10–99 |
| Golden Key | 1,500 KEY | 4% | 100–499 |
| Clean Key | 750 KEY | 15% | 500–1,999 |
| Normal Key | 500 KEY | 80% | 2,000–9,999 |

Average reward is approximately 638.5 KEY per mint. With a 10,000,000 KEY public mint pool, the estimated successful mint count is about 15,600.

## 8. Tokenomics

| Item | Amount |
|---|---:|
| Max supply | 21,000,000 KEY |
| Public mint pool | 10,000,000 KEY |
| LP reserve | 10,000,000 KEY |
| Treasury reserve | 1,000,000 KEY |
| Mint price | 0.001 ETH |
| Wallet cap | 10 successful mints |
| KEY Card claim | 10 valid mint proofs = 1 ERC721 identity |

## 9. KEYSPACE identity rules

| Rule | Value |
|---|---|
| Claim requirement | 10 valid minted proofs |
| NFT standard | ERC721 |
| Name suffix | `.key` |
| KeyBond | Sum of the 10 KEY rewards |
| NFT rank | Best reward tier among the 10 mints |
| Marketplace | On-chain ETH-native listings |

Rank controls minimum name length:

| Rank | Minimum name length |
|---|---:|
| Genesis | 3 letters |
| Quantum | 4 letters |
| Golden | 5 letters |
| Clean | 6 letters |
| Normal | 7 letters |

## 10. Contract-level fairness

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

## 11. Proof transparency

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

## 12. Mainnet contract flow

The active mint gate is `KEYMintGateV3`. It enforces the ten-mint wallet cap, checks legacy gates for used proofs and public key hashes, and prevents reused proof material.

The active registrar is `KEYSpaceRegistrarV3`. It opens origin claims immediately after a wallet has ten valid minted proofs. It marks each proof as claimed, transfers the combined KEY reward into the registrar as KeyBond, and mints one ERC721 KEY Card NFT through `KEYIdentity`.

The active marketplace is `KEYSpaceMarket`. Owners can list approved KEY Card NFTs for ETH, buyers can purchase on-chain, and the locked KeyBond remains inside the identity and follows the NFT owner.

## 13. Trust model

| Component | Trust assumption | Mitigation |
|---|---|---|
| Frontend | User sees exact message and key hash | Open source frontend and static deploy |
| Backend | Verifies signature correctly | Publish proof records and external verifier command |
| Attestation signer | Signs only valid proofs | Hardware wallet / secure server / rotation procedure |
| Mint contract | Enforces price, cap, tier, proof reuse | Verify source and audit |
| Registrar | Enforces 10 proofs per NFT and locks KeyBond | Verify source and audit |
| Marketplace | Trades ERC721 identities for ETH | Verify source and audit |

## 14. Public hardening

The mainnet flow is live, but public hardening still matters. Contract source should be verified on Etherscan, owner controls should move to multisig custody, proof snapshots should be published for independent checking, and the full mint/claim/market flow should receive external review before high traffic.
