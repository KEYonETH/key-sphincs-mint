import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-keyspace-v2.json");

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

function encodeSetMintGate(targetAddress) {
  const iface = new ethers.Interface(["function setMintGate(address gate)"]);
  return iface.encodeFunctionData("setMintGate", [targetAddress]);
}

function encodeSetRegistrar(targetAddress) {
  const iface = new ethers.Interface(["function setRegistrar(address registrar)"]);
  return iface.encodeFunctionData("setRegistrar", [targetAddress]);
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

if (ownerSigner && ownerSigner.address.toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`Owner private key belongs to ${ownerSigner.address}, expected ${owner}`);
}

const keyToken = address("KEY_TOKEN_ADDRESS", value("VITE_KEY_TOKEN_ADDRESS"));
const vault = address("TREASURY_VAULT_ADDRESS", value("VITE_TREASURY_VAULT_ADDRESS"));
const identity = address("KEY_IDENTITY_ADDRESS", value("VITE_KEY_IDENTITY_ADDRESS"));
const backendSigner = address("BACKEND_SIGNER_ADDRESS");
const legacyMintGate = address("LEGACY_MINT_GATE_ADDRESS", value("MINT_GATE_ADDRESS", value("VITE_MINT_GATE_ADDRESS")));
const extraLegacyMintGates = addresses("LEGACY_MINT_GATE_ADDRESSES").filter((gate) => gate !== legacyMintGate);
const registrarLegacyMintGates = [legacyMintGate, ...extraLegacyMintGates];

console.log("Deploying KEYSPACE V2 contracts");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("KEY token:", keyToken);
console.log("vault:", vault);
console.log("KEYIdentity:", identity);
console.log("backend signer:", backendSigner);
console.log("legacy gate:", legacyMintGate);
console.log("extra legacy gates:", extraLegacyMintGates.length ? extraLegacyMintGates.join(", ") : "(none)");
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

await requireCode(provider, "KEY token", keyToken);
await requireCode(provider, "treasury vault", vault);
await requireCode(provider, "KEYIdentity", identity);
await requireCode(provider, "legacy mint gate", legacyMintGate);
for (const gate of extraLegacyMintGates) await requireCode(provider, "extra legacy mint gate", gate);

let mintGateV3 = state.KEYMintGateV3 || optionalAddress("KEY_MINT_GATE_V3_ADDRESS");
if (mintGateV3 !== ethers.ZeroAddress) {
  await requireCode(provider, "KEYMintGateV3", mintGateV3);
  console.log("KEYMintGateV3:", mintGateV3, "(existing)");
} else {
  const art = artifact("KEYMintGateV3.sol/KEYMintGateV3.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const gate = await factory.deploy(keyToken, vault, backendSigner, legacyMintGate, extraLegacyMintGates);
  await waitTx("deploy KEYMintGateV3", gate.deploymentTransaction());
  mintGateV3 = await gate.getAddress();
  state.KEYMintGateV3 = mintGateV3;
  state.KEYMintGateV3DeployTx = gate.deploymentTransaction().hash;
  saveState();
}

let registrarV2 = state.KEYSpaceRegistrarV2 || optionalAddress("KEY_REGISTRAR_V2_ADDRESS");
if (registrarV2 !== ethers.ZeroAddress) {
  await requireCode(provider, "KEYSpaceRegistrarV2", registrarV2);
  console.log("KEYSpaceRegistrarV2:", registrarV2, "(existing)");
} else {
  const art = artifact("KEYSpaceRegistrarV2.sol/KEYSpaceRegistrarV2.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const registrar = await factory.deploy(owner, keyToken, identity, mintGateV3, registrarLegacyMintGates);
  await waitTx("deploy KEYSpaceRegistrarV2", registrar.deploymentTransaction());
  registrarV2 = await registrar.getAddress();
  state.KEYSpaceRegistrarV2 = registrarV2;
  state.KEYSpaceRegistrarV2DeployTx = registrar.deploymentTransaction().hash;
  saveState();
}

const gateAbi = [
  "function owner() view returns(address)",
  "function transferOwnership(address newOwner)",
  "function WALLET_CAP() view returns(uint256)",
  "function token() view returns(address)",
  "function treasuryVault() view returns(address)",
  "function legacyMintGate() view returns(address)",
  "function legacyMintGateCount() view returns(uint256)",
  "function attestationSigner() view returns(address)",
];
const tokenAbi = [
  "function owner() view returns(address)",
  "function mintGate() view returns(address)",
  "function setMintGate(address gate)",
];
const vaultAbi = [
  "function owner() view returns(address)",
  "function mintGate() view returns(address)",
  "function setMintGate(address gate)",
];
const identityAbi = [
  "function owner() view returns(address)",
  "function registrar() view returns(address)",
  "function setRegistrar(address registrar)",
];
const registrarAbi = [
  "function owner() view returns(address)",
  "function keyToken() view returns(address)",
  "function identity() view returns(address)",
  "function REQUIRED_MINTS_PER_IDENTITY() view returns(uint256)",
  "function allowedMintGate(address) view returns(bool)",
  "function originClaimsOpen() view returns(bool)",
  "function canOpenOriginClaims() view returns(bool)",
];

const gate = new ethers.Contract(mintGateV3, gateAbi, deployer);
const token = new ethers.Contract(keyToken, tokenAbi, provider);
const vaultContract = new ethers.Contract(vault, vaultAbi, provider);
const identityContract = new ethers.Contract(identity, identityAbi, provider);
const registrar = new ethers.Contract(registrarV2, registrarAbi, provider);

const gateOwner = ethers.getAddress(await gate.owner());
if (gateOwner === deployer.address && gateOwner !== owner) {
  await waitTx("transfer KEYMintGateV3 ownership", await gate.transferOwnership(owner));
  state.KEYMintGateV3OwnershipTransferred = true;
  saveState();
}

const tokenOwner = ethers.getAddress(await token.owner());
const vaultOwner = ethers.getAddress(await vaultContract.owner());
const identityOwner = ethers.getAddress(await identityContract.owner());

if (ownerSigner && tokenOwner === owner && ethers.getAddress(await token.mintGate()) !== mintGateV3) {
  await waitTx("activate KEYMintGateV3 on token", await token.connect(ownerSigner).setMintGate(mintGateV3));
  state.tokenMintGateSetToV3 = true;
  saveState();
}

if (ownerSigner && vaultOwner === owner && ethers.getAddress(await vaultContract.mintGate()) !== mintGateV3) {
  await waitTx("activate KEYMintGateV3 on vault", await vaultContract.connect(ownerSigner).setMintGate(mintGateV3));
  state.vaultMintGateSetToV3 = true;
  saveState();
}

if (ownerSigner && identityOwner === owner && ethers.getAddress(await identityContract.registrar()) !== registrarV2) {
  await waitTx("activate KEYSpaceRegistrarV2 on identity", await identityContract.connect(ownerSigner).setRegistrar(registrarV2));
  state.identityRegistrarSetToV2 = true;
  saveState();
}

const summary = {
  KEYMintGateV3: mintGateV3,
  KEYSpaceRegistrarV2: registrarV2,
  walletCap: String(await gate.WALLET_CAP()),
  legacyMintGateCount: String(await gate.legacyMintGateCount()),
  requiredMintsPerIdentity: String(await registrar.REQUIRED_MINTS_PER_IDENTITY()),
  tokenMintGate: await token.mintGate(),
  vaultMintGate: await vaultContract.mintGate(),
  identityRegistrar: await identityContract.registrar(),
  originClaimsOpen: await registrar.originClaimsOpen(),
  canOpenOriginClaims: await registrar.canOpenOriginClaims(),
  allowedMintGateV3: await registrar.allowedMintGate(mintGateV3),
  updatedAt: new Date().toISOString(),
};
Object.assign(state, summary);
saveState();

console.log("");
console.log("KEYSPACE V2 deployment summary");
console.log(JSON.stringify(summary, null, 2));

if (!ownerSigner) {
  console.log("");
  console.log("Owner actions required:");
  console.log("token setMintGate target:", keyToken);
  console.log("token setMintGate calldata:", encodeSetMintGate(mintGateV3));
  console.log("vault setMintGate target:", vault);
  console.log("vault setMintGate calldata:", encodeSetMintGate(mintGateV3));
  console.log("identity setRegistrar target:", identity);
  console.log("identity setRegistrar calldata:", encodeSetRegistrar(registrarV2));
}
