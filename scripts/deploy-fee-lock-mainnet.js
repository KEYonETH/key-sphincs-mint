import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-fee-lock-v4.json");

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

function optionalPrivateKey(...names) {
  for (const name of names) {
    const next = value(name);
    if (next) return next.startsWith("0x") ? next : `0x${next}`;
  }
  return "";
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

function addresses(name) {
  return value(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!ethers.isAddress(item)) throw new Error(`${name} contains an invalid address`);
      return ethers.getAddress(item);
    });
}

function uniqueAddresses(items) {
  return items
    .filter((item) => ethers.isAddress(item))
    .map((item) => ethers.getAddress(item))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function artifact(contractPath) {
  return JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", contractPath), "utf8"));
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

function updateEnvFile(file, updates) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, nextValue] of Object.entries(updates)) {
    if (!seen.has(key)) nextLines.push(`${key}=${nextValue}`);
  }
  fs.writeFileSync(file, `${nextLines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`);
}

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const owner = address("CONTRACT_OWNER_ADDRESS");
const ownerKey = optionalPrivateKey("CONTRACT_OWNER_PRIVATE_KEY", "OWNER_PRIVATE_KEY", "MAINNET_OWNER_PRIVATE_KEY");
const ownerSigner = deployer.address.toLowerCase() === owner.toLowerCase()
  ? deployer
  : ownerKey
    ? new ethers.Wallet(ownerKey, provider)
    : null;

if (!ownerSigner) throw new Error("Owner private key is required to activate the new mint gate");
if (ownerSigner.address.toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`Owner private key belongs to ${ownerSigner.address}, expected ${owner}`);
}

const keyToken = address("KEY_TOKEN_ADDRESS", value("VITE_KEY_TOKEN_ADDRESS"));
const backendSigner = address("BACKEND_SIGNER_ADDRESS");
const registrar = address("KEY_REGISTRAR_ADDRESS", value("VITE_KEY_REGISTRAR_ADDRESS"));
const currentMintGate = address("MINT_GATE_ADDRESS", value("VITE_MINT_GATE_ADDRESS"));
const oldVault = optionalAddress("TREASURY_VAULT_ADDRESS", value("VITE_TREASURY_VAULT_ADDRESS"));
const previousLegacyGates = addresses("LEGACY_MINT_GATE_ADDRESSES");
const additionalLegacyMintGates = uniqueAddresses(previousLegacyGates.filter((gate) => gate.toLowerCase() !== currentMintGate.toLowerCase()));
const nextLegacyGates = uniqueAddresses([currentMintGate, ...previousLegacyGates]);
const liquidityManager = optionalAddress("LIQUIDITY_MANAGER_ADDRESS", owner);

console.log("Deploying fee-lock mint flow");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("KEY token:", keyToken);
console.log("registrar:", registrar);
console.log("current mint gate:", currentMintGate);
console.log("current treasury vault:", oldVault);
console.log("backend signer:", backendSigner);
console.log("new liquidity manager:", liquidityManager);
console.log("legacy gates after activation:", nextLegacyGates.join(", "));
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

await requireCode(provider, "KEY token", keyToken);
await requireCode(provider, "KEYSPACE registrar", registrar);
await requireCode(provider, "current mint gate", currentMintGate);
if (oldVault !== ethers.ZeroAddress) await requireCode(provider, "current treasury vault", oldVault);
for (const gate of previousLegacyGates) await requireCode(provider, "legacy mint gate", gate);

let lockVault = state.KEYTreasuryLockVault || optionalAddress("KEY_TREASURY_LOCK_VAULT_ADDRESS");
if (lockVault !== ethers.ZeroAddress) {
  await requireCode(provider, "KEYTreasuryLockVault", lockVault);
  console.log("KEYTreasuryLockVault:", lockVault, "(existing)");
} else {
  const art = artifact("KEYTreasuryLockVault.sol/KEYTreasuryLockVault.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const vault = await factory.deploy(owner);
  await waitTx("deploy KEYTreasuryLockVault", vault.deploymentTransaction());
  lockVault = await vault.getAddress();
  state.KEYTreasuryLockVault = lockVault;
  state.KEYTreasuryLockVaultDeployTx = vault.deploymentTransaction().hash;
  saveState();
}

let mintGateV4 = state.KEYMintGateV4 || optionalAddress("KEY_MINT_GATE_V4_ADDRESS");
if (mintGateV4 !== ethers.ZeroAddress) {
  await requireCode(provider, "KEYMintGateV4", mintGateV4);
  console.log("KEYMintGateV4:", mintGateV4, "(existing)");
} else {
  const art = artifact("KEYMintGateV4.sol/KEYMintGateV4.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const gate = await factory.deploy(keyToken, lockVault, backendSigner, currentMintGate, additionalLegacyMintGates);
  await waitTx("deploy KEYMintGateV4", gate.deploymentTransaction());
  mintGateV4 = await gate.getAddress();
  state.KEYMintGateV4 = mintGateV4;
  state.KEYMintGateV4DeployTx = gate.deploymentTransaction().hash;
  saveState();
}

const gateAbi = [
  "function owner() view returns(address)",
  "function transferOwnership(address newOwner)",
  "function treasuryVault() view returns(address)",
  "function legacyMintGate() view returns(address)",
  "function legacyMintGateCount() view returns(uint256)",
  "function attestationSigner() view returns(address)",
  "function walletMintsTotal(address minter) view returns(uint256)",
];
const lockVaultAbi = [
  "function owner() view returns(address)",
  "function mintGate() view returns(address)",
  "function liquidityManager() view returns(address)",
  "function unlocked() view returns(bool)",
  "function setMintGate(address gate)",
  "function setLiquidityManager(address manager)",
  "function setUnlocked(bool open)",
  "function totalMintFeesReceived() view returns(uint256)",
];
const tokenAbi = [
  "function owner() view returns(address)",
  "function mintGate() view returns(address)",
  "function setMintGate(address gate)",
];
const registrarAbi = [
  "function owner() view returns(address)",
  "function allowedMintGate(address gate) view returns(bool)",
  "function setMintGateAllowed(address gate, bool allowed)",
];

const gate = new ethers.Contract(mintGateV4, gateAbi, deployer);
const lock = new ethers.Contract(lockVault, lockVaultAbi, provider);
const token = new ethers.Contract(keyToken, tokenAbi, provider);
const registrarContract = new ethers.Contract(registrar, registrarAbi, provider);

const gateOwner = ethers.getAddress(await gate.owner());
if (gateOwner.toLowerCase() === deployer.address.toLowerCase() && gateOwner.toLowerCase() !== owner.toLowerCase()) {
  await waitTx("transfer KEYMintGateV4 ownership", await gate.transferOwnership(owner));
  state.KEYMintGateV4OwnershipTransferred = true;
  saveState();
}

const lockOwner = ethers.getAddress(await lock.owner());
if (lockOwner.toLowerCase() !== owner.toLowerCase()) throw new Error(`Lock vault owner is ${lockOwner}, expected ${owner}`);

if (ethers.getAddress(await lock.mintGate()) !== mintGateV4) {
  await waitTx("set lock vault mint gate", await lock.connect(ownerSigner).setMintGate(mintGateV4));
  state.lockVaultMintGateSet = true;
  saveState();
}

const configuredManager = await lock.liquidityManager();
if (configuredManager === ethers.ZeroAddress && liquidityManager !== ethers.ZeroAddress) {
  await waitTx("set lock vault liquidity manager", await lock.connect(ownerSigner).setLiquidityManager(liquidityManager));
  state.lockVaultLiquidityManagerSet = true;
  saveState();
}

if (ethers.getAddress(await token.owner()).toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`KEYToken owner is ${await token.owner()}, expected ${owner}`);
}
if (ethers.getAddress(await token.mintGate()).toLowerCase() !== mintGateV4.toLowerCase()) {
  await waitTx("activate KEYMintGateV4 on token", await token.connect(ownerSigner).setMintGate(mintGateV4));
  state.tokenMintGateSetToV4 = true;
  saveState();
}

if (ethers.getAddress(await registrarContract.owner()).toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`Registrar owner is ${await registrarContract.owner()}, expected ${owner}`);
}
if (!(await registrarContract.allowedMintGate(mintGateV4))) {
  await waitTx("allow KEYMintGateV4 on registrar", await registrarContract.connect(ownerSigner).setMintGateAllowed(mintGateV4, true));
  state.registrarAllowsMintGateV4 = true;
  saveState();
}

const summary = {
  KEYTreasuryLockVault: lockVault,
  KEYMintGateV4: mintGateV4,
  oldMintGate: currentMintGate,
  oldTreasuryVault: oldVault,
  tokenMintGate: await token.mintGate(),
  lockVaultMintGate: await lock.mintGate(),
  lockVaultLiquidityManager: await lock.liquidityManager(),
  lockVaultUnlocked: await lock.unlocked(),
  registrarAllowedMintGateV4: await registrarContract.allowedMintGate(mintGateV4),
  legacyMintGateCount: String(await gate.legacyMintGateCount()),
  legacyMintGatesForEnv: nextLegacyGates,
  updatedAt: new Date().toISOString(),
};
Object.assign(state, summary);
saveState();

const envUpdates = {
  MINT_GATE_ADDRESS: mintGateV4,
  VITE_MINT_GATE_ADDRESS: mintGateV4,
  KEY_MINT_GATE_ADDRESS: mintGateV4,
  KEY_MINT_GATE_V4_ADDRESS: mintGateV4,
  TREASURY_VAULT_ADDRESS: lockVault,
  VITE_TREASURY_VAULT_ADDRESS: lockVault,
  KEY_TREASURY_LOCK_VAULT_ADDRESS: lockVault,
  LEGACY_MINT_GATE_ADDRESSES: nextLegacyGates.join(","),
};
updateEnvFile(envFile, envUpdates);

console.log("");
console.log("Fee-lock mint flow summary");
console.log(JSON.stringify(summary, null, 2));
console.log("");
console.log("Updated .env.mainnet with:");
console.log(JSON.stringify(envUpdates, null, 2));
