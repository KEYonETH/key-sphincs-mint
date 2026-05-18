import { config } from 'dotenv';
import { ethers } from 'ethers';

config({ path: '.env.mainnet', override: true });

const POOL_MANAGER = '0x000000000004444c5dc75cB358380D2e3dE08A90';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ZERO_HOOK = '0x0000000000000000000000000000000000000000';

const rpcUrl = process.env.MAINNET_RPC_URL || process.env.ETHEREUM_RPC_URL || process.env.RPC_URL;
const privateKey = process.env.MAINNET_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const keyToken = process.env.KEY_TOKEN_ADDRESS || process.env.VITE_KEY_TOKEN_ADDRESS;

const fee = Number(process.env.UNISWAP_V4_FEE || '0');
const tickSpacing = Number(process.env.UNISWAP_V4_TICK_SPACING || '200');
const keyPerEth = BigInt(process.env.UNISWAP_V4_KEY_PER_ETH || '500000');

if (!rpcUrl) throw new Error('MAINNET_RPC_URL is required in .env.mainnet');
if (!privateKey) throw new Error('MAINNET_PRIVATE_KEY is required in .env.mainnet');
if (!keyToken || !ethers.isAddress(keyToken)) throw new Error('KEY_TOKEN_ADDRESS is required in .env.mainnet');

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const poolManager = new ethers.Contract(
  POOL_MANAGER,
  ['function initialize((address,address,uint24,int24,address) key,uint160 sqrtPriceX96) external returns (int24)'],
  wallet
);

function sortCurrencies(a, b) {
  return BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? [a, b] : [b, a];
}

function sqrtBigInt(value) {
  if (value < 0n) throw new Error('sqrt only works on positive integers');
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function sqrtPriceX96ForPrice({ currency0, currency1 }) {
  const q192 = 1n << 192n;
  let numerator;
  let denominator;

  if (currency0.toLowerCase() === keyToken.toLowerCase()) {
    numerator = 1n;
    denominator = keyPerEth;
  } else {
    numerator = keyPerEth;
    denominator = 1n;
  }

  return sqrtBigInt((numerator * q192) / denominator);
}

const [currency0, currency1] = sortCurrencies(ethers.getAddress(keyToken), WETH);
const poolKey = [currency0, currency1, fee, tickSpacing, ZERO_HOOK];
const sqrtPriceX96 = sqrtPriceX96ForPrice({ currency0, currency1 });
const poolId = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'],
    [poolKey]
  )
);

console.log('Initializer:', wallet.address);
console.log('PoolManager:', POOL_MANAGER);
console.log('KEY:', ethers.getAddress(keyToken));
console.log('WETH:', WETH);
console.log('currency0:', currency0);
console.log('currency1:', currency1);
console.log('fee:', fee);
console.log('tickSpacing:', tickSpacing);
console.log('hook:', ZERO_HOOK);
console.log('initialPrice:', `1 ETH = ${keyPerEth.toLocaleString('en-US')} KEY`);
console.log('sqrtPriceX96:', sqrtPriceX96.toString());
console.log('poolId:', poolId);

const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  console.log('Dry run only. No transaction sent.');
  process.exit(0);
}

const eth = await provider.getBalance(wallet.address);
console.log('initializerEth:', ethers.formatEther(eth));
if (eth < ethers.parseEther('0.003')) {
  throw new Error('Initializer wallet needs more ETH for gas before initializing the pool');
}

try {
  const tick = await poolManager.initialize.staticCall(poolKey, sqrtPriceX96);
  console.log('expectedTick:', tick.toString());
} catch (error) {
  const message = error?.shortMessage || error?.reason || error?.message || String(error);
  throw new Error(`Pool initialize simulation failed: ${message}`);
}

const tx = await poolManager.initialize(poolKey, sqrtPriceX96);
console.log('tx:', tx.hash);
const receipt = await tx.wait();
console.log('confirmedBlock:', receipt.blockNumber);
console.log('UNISWAP_V4_POOL_ID=' + poolId);
console.log('UNISWAP_V4_HOOK_ADDRESS=' + ZERO_HOOK);
