import 'dotenv/config';
import { ethers } from 'ethers';

export const TOKENOMICS = Object.freeze({
  token: 'KEY',
  maxSupply: 21_000_000,
  publicMintPool: 10_000_000,
  lpReserve: 10_000_000,
  treasuryReserve: 1_000_000,
  mintPriceEth: '0.001',
  walletCap: 3,
  estimatedMints: 15600,
  network: 'Ethereum'
});

export const TIERS = Object.freeze([
  { id: 0, name: 'Normal Key', reward: 500, odds: '80%', thresholdMaxExclusive: 10000, lowerBound: 2000 },
  { id: 1, name: 'Clean Key', reward: 750, odds: '15%', thresholdMaxExclusive: 2000, lowerBound: 500 },
  { id: 2, name: 'Golden Key', reward: 1500, odds: '4%', thresholdMaxExclusive: 500, lowerBound: 100 },
  { id: 3, name: 'Quantum Key', reward: 5000, odds: '0.9%', thresholdMaxExclusive: 100, lowerBound: 10 },
  { id: 4, name: 'Genesis Key', reward: 21000, odds: '0.1%', thresholdMaxExclusive: 10, lowerBound: 0 }
]);

export function tierFromRewardHash(rewardHash) {
  const roll = Number(BigInt(rewardHash) % 10000n);
  if (roll < 10) return TIERS[4];
  if (roll < 100) return TIERS[3];
  if (roll < 500) return TIERS[2];
  if (roll < 2000) return TIERS[1];
  return TIERS[0];
}

export function requiredEnvAddress(name, fallback = ethers.ZeroAddress) {
  const value = process.env[name] || fallback;
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
}

export const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 8787),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  chainId: Number(process.env.CHAIN_ID || 1),
  mintGateAddress: requiredEnvAddress('MINT_GATE_ADDRESS'),
  proofDataDir: process.env.PROOF_DATA_DIR || './backend/data',
  sphincsVerifyMode: process.env.SPHINCS_VERIFY_MODE || 'preview',
  sphincsVerifyCommand: process.env.SPHINCS_VERIFY_COMMAND || '',
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS || 600000)
});
