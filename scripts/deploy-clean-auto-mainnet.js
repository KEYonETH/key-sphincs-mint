import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-clean-auto.json");
const POSITION_MANAGER = "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e";
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ZERO_HOOK = "0x0000000000000000000000000000000000000000";

if (!fs.existsSync(envFile)) throw new Error(".env.mainnet is required");
if (!fs.existsSync("deployments")) fs.mkdirSync("deployments", { recursive: true });

const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

function saveState() {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function value(name, fallback = "") {
  return String(env[name] || fallback || "").trim();
}

function requireValue(name, fallback = "") {
  const next = value(name, fallback);
  if (!next) throw new Error(`${name} is required`);
  return next;
}

function privateKey(name) {
  const next = requireValue(name);
  return next.startsWith("0x") ? next : `0x${next}`;
}

function address(name, fallback = "") {
  const next = requireValue(name, fallback);
  if (!ethers.isAddress(next)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(next);
}

function optionalAddress(name, fallback = ethers.ZeroAddress) {
  const next = value(name, fallback);
  if (!next || next === ethers.ZeroAddress) return ethers.ZeroAddress;
  if (!ethers.isAddress(next)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(next);
}

function artifact(contractPath) {
  return JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", contractPath), "utf8"));
}

function updateEnvFile(updates) {
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, val] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${val}`);
  }
  fs.writeFileSync(envFile, `${next.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`);
  Object.assign(env, updates);
}

async function waitTx(label, tx) {
  console.log(`${label} tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label}: confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function requireCode(label, target) {
  const code = await provider.getCode(target);
  if (code === "0x") throw new Error(`${label} has no code at ${target}`);
}

async function deployIfMissing(label, artifactFile, args) {
  const configured = optionalAddress(label.toUpperCase(), state[label] || ethers.ZeroAddress);
  if (configured !== ethers.ZeroAddress) {
    await requireCode(label, configured);
    state[label] = configured;
    saveState();
    console.log(`${label}: ${configured} (existing)`);
    return configured;
  }

  const art = artifact(artifactFile);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const contract = await factory.deploy(...args);
  await waitTx(`deploy ${label}`, contract.deploymentTransaction());
  const deployed = await contract.getAddress();
  state[label] = deployed;
  state[`${label}DeployTx`] = contract.deploymentTransaction().hash;
  saveState();
  console.log(`${label}: ${deployed}`);
  return deployed;
}

function sortCurrencies(a, b) {
  return BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? [a, b] : [b, a];
}

function sqrtBigInt(x) {
  if (x < 0n) throw new Error("sqrt negative");
  if (x < 2n) return x;
  let z = x / 2n;
  let y = (z + x / z) / 2n;
  while (y < z) {
    z = y;
    y = (z + x / z) / 2n;
  }
  return z;
}

function sqrtPriceX96ForPrice(currency0, keyToken) {
  const q192 = 1n << 192n;
  const keyPerEth = BigInt(value("UNISWAP_V4_KEY_PER_ETH", "500000"));
  const numerator = currency0.toLowerCase() === keyToken.toLowerCase() ? 1n : keyPerEth;
  const denominator = currency0.toLowerCase() === keyToken.toLowerCase() ? keyPerEth : 1n;
  return sqrtBigInt((numerator * q192) / denominator);
}

async function initializePoolLast(keyToken) {
  if (state.UNISWAP_V4_POOL_ID && state.UNISWAP_V4_INITIALIZE_TX) {
    console.log("Uniswap v4 pool: already initialized in clean state");
    return {
      poolId: state.UNISWAP_V4_POOL_ID,
      initializeTx: state.UNISWAP_V4_INITIALIZE_TX,
    };
  }

  const fee = Number(value("UNISWAP_V4_FEE", "0"));
  const tickSpacing = Number(value("UNISWAP_V4_TICK_SPACING", "200"));
  const [currency0, currency1] = sortCurrencies(ethers.getAddress(keyToken), WETH);
  const poolKey = [currency0, currency1, fee, tickSpacing, ZERO_HOOK];
  const sqrtPriceX96 = sqrtPriceX96ForPrice(currency0, keyToken);
  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"],
      [poolKey]
    )
  );
  const poolManager = new ethers.Contract(
    POOL_MANAGER,
    ["function initialize((address,address,uint24,int24,address) key,uint160 sqrtPriceX96) external returns (int24)"],
    deployer
  );

  console.log("");
  console.log("Initializing Uniswap v4 pool last");
  console.log("poolId:", poolId);
  console.log("currency0:", currency0);
  console.log("currency1:", currency1);
  console.log("fee:", fee);
  console.log("tickSpacing:", tickSpacing);
  await poolManager.initialize.staticCall(poolKey, sqrtPriceX96);
  const tx = await poolManager.initialize(poolKey, sqrtPriceX96);
  await waitTx("initialize Uniswap v4 KEY/WETH pool", tx);
  state.UNISWAP_V4_POOL_ID = poolId;
  state.UNISWAP_V4_INITIALIZE_TX = tx.hash;
  state.UNISWAP_V4_FEE = String(fee);
  state.UNISWAP_V4_TICK_SPACING = String(tickSpacing);
  saveState();
  return { poolId, initializeTx: tx.hash };
}

if (requireValue("MAINNET_DEPLOY_CONFIRM") !== "DEPLOY_KEY_MAINNET") {
  throw new Error("MAINNET_DEPLOY_CONFIRM must be DEPLOY_KEY_MAINNET");
}

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const owner = address("CONTRACT_OWNER_ADDRESS");
const ownerSigner = deployer.address.toLowerCase() === owner.toLowerCase()
  ? deployer
  : new ethers.Wallet(privateKey("CONTRACT_OWNER_PRIVATE_KEY"), provider);
if (ownerSigner.address.toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`CONTRACT_OWNER_PRIVATE_KEY belongs to ${ownerSigner.address}, expected ${owner}`);
}
const signerWallet = new ethers.Wallet(privateKey("SIGNER_PRIVATE_KEY"));
const backendSigner = address("BACKEND_SIGNER_ADDRESS");
if (signerWallet.address.toLowerCase() !== backendSigner.toLowerCase()) {
  throw new Error(`SIGNER_PRIVATE_KEY belongs to ${signerWallet.address}, expected ${backendSigner}`);
}
const treasuryReserveRecipient = address("TREASURY_RESERVE_RECIPIENT");
const liquidityManager = address("LIQUIDITY_MANAGER_ADDRESS", owner);

const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

console.log("Clean KEY auto-liquidity deploy");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("backend signer:", backendSigner);
console.log("liquidity manager:", liquidityManager);
console.log("treasury reserve:", treasuryReserveRecipient);
console.log("deployer ETH:", ethers.formatEther(await provider.getBalance(deployer.address)));
console.log("owner ETH:", ethers.formatEther(await provider.getBalance(owner)));

const vaultAddress = await deployIfMissing("KEYAutoLiquidityVault", "KEYAutoLiquidityVault.sol/KEYAutoLiquidityVault.json", [
  owner,
  liquidityManager,
  POSITION_MANAGER,
]);
updateEnvFile({
  KEY_AUTO_LIQUIDITY_VAULT_ADDRESS: vaultAddress,
  TREASURY_VAULT_ADDRESS: vaultAddress,
  VITE_TREASURY_VAULT_ADDRESS: vaultAddress,
  LP_RESERVE_RECIPIENT: vaultAddress,
  VITE_LP_RESERVE_ADDRESS: vaultAddress,
  VITE_TREASURY_RESERVE_ADDRESS: treasuryReserveRecipient,
});

const tokenAddress = await deployIfMissing("KEYToken", "KEYToken.sol/KEYToken.json", [
  vaultAddress,
  treasuryReserveRecipient,
]);
updateEnvFile({
  KEY_TOKEN_ADDRESS: tokenAddress,
  VITE_KEY_TOKEN_ADDRESS: tokenAddress,
});

const vaultAbi = artifact("KEYAutoLiquidityVault.sol/KEYAutoLiquidityVault.json").abi;
const tokenAbi = artifact("KEYToken.sol/KEYToken.json").abi;
const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const token = new ethers.Contract(tokenAddress, tokenAbi, deployer);

if (ethers.getAddress(await vault.keyToken()) !== tokenAddress) {
  await waitTx("set vault KEY token", await vault.connect(ownerSigner).setKeyToken(tokenAddress));
}

const mintGateAddress = await deployIfMissing("KEYMintGateV5", "KEYMintGateV5.sol/KEYMintGateV5.json", [
  tokenAddress,
  vaultAddress,
  backendSigner,
]);
updateEnvFile({
  MINT_GATE_ADDRESS: mintGateAddress,
  VITE_MINT_GATE_ADDRESS: mintGateAddress,
  KEY_MINT_GATE_ADDRESS: mintGateAddress,
  LEGACY_MINT_GATE_ADDRESSES: "",
});

if (ethers.getAddress(await vault.mintGate()) !== mintGateAddress) {
  await waitTx("set vault mint gate", await vault.connect(ownerSigner).setMintGate(mintGateAddress));
}
if (ethers.getAddress(await token.mintGate()) !== mintGateAddress) {
  await waitTx("set token mint gate", await token.setMintGate(mintGateAddress));
}
if ((await token.owner()).toLowerCase() !== owner.toLowerCase()) {
  await waitTx("transfer token ownership", await token.transferOwnership(owner));
}
const gateAbi = artifact("KEYMintGateV5.sol/KEYMintGateV5.json").abi;
const gate = new ethers.Contract(mintGateAddress, gateAbi, deployer);
if ((await gate.owner()).toLowerCase() !== owner.toLowerCase()) {
  await waitTx("transfer mint gate ownership", await gate.transferOwnership(owner));
}

const baseURI = value("KEY_IDENTITY_BASE_URI", "https://api.key-sphincs.xyz/api/keyspace/metadata/");
const identityAddress = await deployIfMissing("KEYIdentity", "KEYIdentity.sol/KEYIdentity.json", [owner, baseURI]);
updateEnvFile({
  KEY_IDENTITY_ADDRESS: identityAddress,
  VITE_KEY_IDENTITY_ADDRESS: identityAddress,
});

const registrarAddress = await deployIfMissing("KEYSpaceRegistrarV3", "KEYSpaceRegistrarV3.sol/KEYSpaceRegistrarV3.json", [
  owner,
  tokenAddress,
  identityAddress,
  mintGateAddress,
  [],
]);
updateEnvFile({
  KEY_REGISTRAR_ADDRESS: registrarAddress,
  VITE_KEY_REGISTRAR_ADDRESS: registrarAddress,
});

const identityAbi = artifact("KEYIdentity.sol/KEYIdentity.json").abi;
const identity = new ethers.Contract(identityAddress, identityAbi, provider);
if (ethers.getAddress(await identity.registrar()) !== registrarAddress) {
  await waitTx("set identity registrar", await identity.connect(ownerSigner).setRegistrar(registrarAddress));
}

const marketAddress = await deployIfMissing("KEYSpaceMarket", "KEYSpaceMarket.sol/KEYSpaceMarket.json", [owner, identityAddress]);
updateEnvFile({
  KEY_MARKET_ADDRESS: marketAddress,
  VITE_KEY_MARKET_ADDRESS: marketAddress,
});
const marketAbi = artifact("KEYSpaceMarket.sol/KEYSpaceMarket.json").abi;
const market = new ethers.Contract(marketAddress, marketAbi, provider);
if (!(await market.marketOpen())) {
  await waitTx("open KEYSPACE market", await market.connect(ownerSigner).setMarketOpen(true));
}
if (String(await market.feeBps()) !== "0") {
  await waitTx("set KEYSPACE market fee 0", await market.connect(ownerSigner).setFee(0, owner));
}

const pool = await initializePoolLast(tokenAddress);
updateEnvFile({
  UNISWAP_V4_POOL_ID: pool.poolId,
  VITE_UNISWAP_V4_POOL_ID: pool.poolId,
  UNISWAP_V4_HOOK_ADDRESS: ZERO_HOOK,
  VITE_UNISWAP_V4_HOOK_ADDRESS: ZERO_HOOK,
  UNISWAP_V4_POOL_MANAGER: POOL_MANAGER,
  UNISWAP_V4_INITIALIZE_TX: pool.initializeTx,
  UNISWAP_V4_FEE: value("UNISWAP_V4_FEE", "0"),
  UNISWAP_V4_TICK_SPACING: value("UNISWAP_V4_TICK_SPACING", "200"),
});

const summary = {
  KEYAutoLiquidityVault: vaultAddress,
  KEYToken: tokenAddress,
  KEYMintGateV5: mintGateAddress,
  KEYIdentity: identityAddress,
  KEYSpaceRegistrarV3: registrarAddress,
  KEYSpaceMarket: marketAddress,
  UNISWAP_V4_POOL_ID: pool.poolId,
  UNISWAP_V4_INITIALIZE_TX: pool.initializeTx,
  owner,
  liquidityManager,
  treasuryReserveRecipient,
  positionManager: POSITION_MANAGER,
  poolManager: POOL_MANAGER,
  weth: WETH,
  updatedAt: new Date().toISOString(),
};
Object.assign(state, summary);
saveState();

console.log("");
console.log("Clean auto-liquidity deployment summary");
console.log(JSON.stringify(summary, null, 2));
