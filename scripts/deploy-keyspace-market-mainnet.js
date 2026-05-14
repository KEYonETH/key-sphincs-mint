import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-keyspace-market.json");

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

function deployOverrides() {
  const overrides = {};
  const maxFeeGwei = value("DEPLOY_MAX_FEE_GWEI");
  const maxPriorityFeeGwei = value("DEPLOY_MAX_PRIORITY_FEE_GWEI", "0.0002");
  if (maxFeeGwei) {
    overrides.maxFeePerGas = ethers.parseUnits(maxFeeGwei, "gwei");
    overrides.maxPriorityFeePerGas = ethers.parseUnits(maxPriorityFeeGwei, "gwei");
  }
  return overrides;
}

async function waitTx(label, tx) {
  console.log(`${label} tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label}: confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function requireCode(provider, label, target) {
  const code = await provider.getCode(target);
  if (code === "0x") throw new Error(`${label} has no code at ${target}`);
}

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const owner = address("CONTRACT_OWNER_ADDRESS");
const identity = address("KEY_IDENTITY_ADDRESS", value("VITE_KEY_IDENTITY_ADDRESS"));

console.log("Deploying KEYSpaceMarket");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("KEYIdentity:", identity);
console.log("payment:", "native ETH");
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

await requireCode(provider, "KEYIdentity", identity);

let marketAddress = state.KEYSpaceMarket || optionalAddress("KEY_MARKET_ADDRESS", value("VITE_KEY_MARKET_ADDRESS"));
if (marketAddress !== ethers.ZeroAddress) {
  try {
    await requireCode(provider, "KEYSpaceMarket", marketAddress);
    const existing = new ethers.Contract(marketAddress, [
      "function identity() view returns(address)",
      "function keyToken() view returns(address)"
    ], provider);
    await existing.keyToken();
    console.log("Existing KEYSpaceMarket uses KEY payments. Deploying ETH replacement.");
    state.previousKEYSpaceMarket = marketAddress;
    marketAddress = ethers.ZeroAddress;
  } catch {
    console.log("KEYSpaceMarket:", marketAddress, "(existing ETH market)");
  }
}

if (marketAddress === ethers.ZeroAddress) {
  if (state.KEYSpaceMarket) {
    state.previousKEYSpaceMarket = state.previousKEYSpaceMarket || state.KEYSpaceMarket;
  }
  if (value("KEY_MARKET_ADDRESS") || value("VITE_KEY_MARKET_ADDRESS")) {
    state.previousEnvKEYSpaceMarket = optionalAddress("KEY_MARKET_ADDRESS", value("VITE_KEY_MARKET_ADDRESS"));
  }
  const art = artifact("KEYSpaceMarket.sol/KEYSpaceMarket.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const market = await factory.deploy(owner, identity, deployOverrides());
  await waitTx("deploy KEYSpaceMarket", market.deploymentTransaction());
  marketAddress = await market.getAddress();
  state.KEYSpaceMarket = marketAddress;
  state.KEYSpaceMarketDeployTx = market.deploymentTransaction().hash;
  state.owner = owner;
  state.identity = identity;
  state.paymentToken = "ETH";
  state.marketOpenDefault = false;
  state.updatedAt = new Date().toISOString();
  saveState();
  console.log("KEYSpaceMarket:", marketAddress);
} else {
  state.updatedAt = new Date().toISOString();
  saveState();
}

const marketAbi = [
  "function owner() view returns(address)",
  "function identity() view returns(address)",
  "function marketOpen() view returns(bool)",
  "function feeBps() view returns(uint16)",
  "function feeRecipient() view returns(address)",
];
const market = new ethers.Contract(marketAddress, marketAbi, provider);
const summary = {
  KEYSpaceMarket: marketAddress,
  owner: await market.owner(),
  identity: await market.identity(),
  paymentToken: "ETH",
  marketOpen: await market.marketOpen(),
  feeBps: String(await market.feeBps()),
  feeRecipient: await market.feeRecipient()
};

console.log("");
console.log("KEYSpaceMarket deployment summary");
console.log(JSON.stringify(summary, null, 2));
