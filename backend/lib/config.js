import 'dotenv/config';
import { ethers } from 'ethers';

export const TOKENOMICS = Object.freeze({
  token: 'KEY',
  maxSupply: 21_000_000,
  publicMintPool: 10_000_000,
  lpReserve: 10_000_000,
  treasuryReserve: 1_000_000,
  mintPriceEth: '0.001',
  walletCap: 10,
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

export function optionalEnvAddress(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
    return ethers.getAddress(value);
  }
  return ethers.ZeroAddress;
}

export function optionalEnvAddresses(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!ethers.isAddress(value)) throw new Error(`${name} contains an invalid address`);
      return ethers.getAddress(value);
    });
}

export const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 8787),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  chainId: Number(process.env.CHAIN_ID || 1),
  rpcUrl: process.env.RPC_URL || process.env.MAINNET_RPC_URL || process.env.ETH_RPC_URL || '',
  mintGateAddress: requiredEnvAddress('MINT_GATE_ADDRESS', process.env.KEY_MINT_GATE_ADDRESS || ethers.ZeroAddress),
  legacyMintGateAddresses: optionalEnvAddresses('LEGACY_MINT_GATE_ADDRESSES'),
  keyTokenAddress: optionalEnvAddress('KEY_TOKEN_ADDRESS', 'VITE_KEY_TOKEN_ADDRESS'),
  keyMintGateAddress: optionalEnvAddress('KEY_MINT_GATE_ADDRESS', 'MINT_GATE_ADDRESS', 'VITE_MINT_GATE_ADDRESS'),
  keyIdentityAddress: optionalEnvAddress('KEY_IDENTITY_ADDRESS', 'VITE_KEY_IDENTITY_ADDRESS'),
  keyRegistrarAddress: optionalEnvAddress('KEY_REGISTRAR_ADDRESS', 'VITE_KEY_REGISTRAR_ADDRESS'),
  keyMarketAddress: optionalEnvAddress('KEY_MARKET_ADDRESS', 'VITE_KEY_MARKET_ADDRESS'),
  treasuryVaultAddress: optionalEnvAddress('TREASURY_VAULT_ADDRESS', 'VITE_TREASURY_VAULT_ADDRESS'),
  legacyTreasuryVaultAddresses: optionalEnvAddresses('LEGACY_TREASURY_VAULT_ADDRESSES'),
  lpReserveAddress: optionalEnvAddress('LP_RESERVE_RECIPIENT', 'VITE_LP_RESERVE_ADDRESS'),
  treasuryReserveAddress: optionalEnvAddress('TREASURY_RESERVE_RECIPIENT', 'VITE_TREASURY_RESERVE_ADDRESS'),
  contractOwnerAddress: optionalEnvAddress('CONTRACT_OWNER_ADDRESS', 'VITE_CONTRACT_OWNER_ADDRESS'),
  uniswapV4PoolId: process.env.UNISWAP_V4_POOL_ID || process.env.VITE_UNISWAP_V4_POOL_ID || '',
  uniswapV4HookAddress: process.env.UNISWAP_V4_HOOK_ADDRESS || process.env.VITE_UNISWAP_V4_HOOK_ADDRESS || '',
  uniswapV4PoolManager: process.env.UNISWAP_V4_POOL_MANAGER || '0x000000000004444c5dc75cB358380D2e3dE08A90',
  uniswapV4InitializeTx: process.env.UNISWAP_V4_INITIALIZE_TX || '',
  uniswapV4InitialPrice: process.env.UNISWAP_V4_INITIAL_PRICE || '',
  uniswapV4Fee: process.env.UNISWAP_V4_FEE || '',
  uniswapV4TickSpacing: process.env.UNISWAP_V4_TICK_SPACING || '',
  proofDataDir: process.env.PROOF_DATA_DIR || './backend/data',
  sphincsVerifyMode: process.env.SPHINCS_VERIFY_MODE || 'preview',
  sphincsVerifyCommand: process.env.SPHINCS_VERIFY_COMMAND || '',
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS || 600000)
});
