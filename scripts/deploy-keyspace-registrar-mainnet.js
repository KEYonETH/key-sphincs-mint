import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-keyspace-registrar.json");

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

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const owner = address("CONTRACT_OWNER_ADDRESS");
const keyToken = address("KEY_TOKEN_ADDRESS", value("VITE_KEY_TOKEN_ADDRESS"));
const identity = address("KEY_IDENTITY_ADDRESS", value("VITE_KEY_IDENTITY_ADDRESS"));
const primaryMintGate = address("KEY_MINT_GATE_ADDRESS", value("MINT_GATE_ADDRESS", value("VITE_MINT_GATE_ADDRESS")));
const legacyMintGates = addresses("LEGACY_MINT_GATE_ADDRESSES");

console.log("Deploying KEYSpaceRegistrar");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("KEY token:", keyToken);
console.log("KEYIdentity:", identity);
console.log("primary mint gate:", primaryMintGate);
console.log("legacy mint gates:", legacyMintGates.length ? legacyMintGates.join(", ") : "(none)");
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

await requireCode(provider, "KEY token", keyToken);
await requireCode(provider, "KEYIdentity", identity);
await requireCode(provider, "primary mint gate", primaryMintGate);
for (const gate of legacyMintGates) await requireCode(provider, "legacy mint gate", gate);

let registrarAddress = state.KEYSpaceRegistrar || optionalAddress("KEY_REGISTRAR_ADDRESS", value("VITE_KEY_REGISTRAR_ADDRESS"));
if (registrarAddress !== ethers.ZeroAddress) {
  await requireCode(provider, "KEYSpaceRegistrar", registrarAddress);
  console.log("KEYSpaceRegistrar:", registrarAddress, "(existing)");
} else {
  const art = artifact("KEYSpaceRegistrar.sol/KEYSpaceRegistrar.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const registrar = await factory.deploy(owner, keyToken, identity, primaryMintGate, legacyMintGates);
  await waitTx("deploy KEYSpaceRegistrar", registrar.deploymentTransaction());
  registrarAddress = await registrar.getAddress();
  state.KEYSpaceRegistrar = registrarAddress;
  state.KEYSpaceRegistrarDeployTx = registrar.deploymentTransaction().hash;
  state.owner = owner;
  state.keyToken = keyToken;
  state.identity = identity;
  state.primaryMintGate = primaryMintGate;
  state.legacyMintGates = legacyMintGates;
  state.updatedAt = new Date().toISOString();
  saveState();
  console.log("KEYSpaceRegistrar:", registrarAddress);
}

const registrarAbi = [
  "function owner() view returns(address)",
  "function keyToken() view returns(address)",
  "function identity() view returns(address)",
  "function originClaimsOpen() view returns(bool)",
  "function canOpenOriginClaims() view returns(bool)",
  "function allowedMintGate(address) view returns(bool)",
  "function exitFeeBps() view returns(uint16)",
  "function minNameLengthForRank(uint8) view returns(uint256)",
];
const identityAbi = [
  "function owner() view returns(address)",
  "function registrar() view returns(address)",
  "function setRegistrar(address registrar) external",
];
const registrar = new ethers.Contract(registrarAddress, registrarAbi, provider);
const identityContract = new ethers.Contract(identity, identityAbi, provider);

const currentIdentityRegistrar = await identityContract.registrar();
if (ethers.getAddress(currentIdentityRegistrar) !== ethers.getAddress(registrarAddress)) {
  let ownerSigner = null;
  const ownerKey = optionalPrivateKey("CONTRACT_OWNER_PRIVATE_KEY", "OWNER_PRIVATE_KEY", "MAINNET_OWNER_PRIVATE_KEY");
  if (deployer.address.toLowerCase() === owner.toLowerCase()) {
    ownerSigner = deployer;
  } else if (ownerKey) {
    const candidate = new ethers.Wallet(ownerKey, provider);
    if (candidate.address.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(`Owner private key belongs to ${candidate.address}, expected ${owner}`);
    }
    ownerSigner = candidate;
  }

  if (ownerSigner) {
    await waitTx("KEYIdentity setRegistrar", await identityContract.connect(ownerSigner).setRegistrar(registrarAddress));
    state.identityRegistrarSet = true;
    state.identityRegistrarTxAt = new Date().toISOString();
    saveState();
  } else {
    console.log("");
    console.log("ACTION_REQUIRED: KEYIdentity registrar is not set and no owner signer was available.");
    console.log(`Call setRegistrar(${registrarAddress}) on KEYIdentity ${identity} from owner ${owner}.`);
    state.identityRegistrarSet = false;
    saveState();
  }
} else {
  state.identityRegistrarSet = true;
  saveState();
}

const summary = {
  KEYSpaceRegistrar: registrarAddress,
  owner: await registrar.owner(),
  keyToken: await registrar.keyToken(),
  identity: await registrar.identity(),
  identityRegistrar: await identityContract.registrar(),
  originClaimsOpen: await registrar.originClaimsOpen(),
  canOpenOriginClaims: await registrar.canOpenOriginClaims(),
  exitFeeBps: String(await registrar.exitFeeBps()),
  allowedPrimaryMintGate: await registrar.allowedMintGate(primaryMintGate),
  rankMinLengths: {
    Genesis: String(await registrar.minNameLengthForRank(4)),
    Quantum: String(await registrar.minNameLengthForRank(3)),
    Golden: String(await registrar.minNameLengthForRank(2)),
    Clean: String(await registrar.minNameLengthForRank(1)),
    Normal: String(await registrar.minNameLengthForRank(0)),
  }
};

console.log("");
console.log("KEYSpaceRegistrar deployment summary");
console.log(JSON.stringify(summary, null, 2));
