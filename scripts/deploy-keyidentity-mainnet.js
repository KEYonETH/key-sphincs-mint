import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-keyidentity.json");

if (!fs.existsSync(envFile)) throw new Error(".env.mainnet is required");
if (!fs.existsSync("deployments")) fs.mkdirSync("deployments", { recursive: true });

const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

function saveState() {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function requireValue(name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(name) {
  const value = requireValue(name);
  return value.startsWith("0x") ? value : `0x${value}`;
}

function address(name) {
  const value = requireValue(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
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

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const owner = address("CONTRACT_OWNER_ADDRESS");
const baseURI = String(env.KEY_IDENTITY_BASE_URI || "https://api.key-sphincs.xyz/api/keyspace/metadata/").trim();

console.log("Deploying KEYIdentity");
console.log("deployer:", deployer.address);
console.log("owner:", owner);
console.log("baseURI:", baseURI);
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

let identityAddress = state.KEYIdentity;
if (identityAddress) {
  const code = await provider.getCode(identityAddress);
  if (code === "0x") throw new Error(`state has KEYIdentity=${identityAddress}, but no code exists there`);
  console.log("KEYIdentity:", identityAddress, "(existing)");
} else {
  const art = artifact("KEYIdentity.sol/KEYIdentity.json");
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
  const identity = await factory.deploy(owner, baseURI);
  await waitTx("deploy KEYIdentity", identity.deploymentTransaction());
  identityAddress = await identity.getAddress();
  state.KEYIdentity = identityAddress;
  state.KEYIdentityDeployTx = identity.deploymentTransaction().hash;
  state.owner = owner;
  state.baseURI = baseURI;
  state.updatedAt = new Date().toISOString();
  saveState();
  console.log("KEYIdentity:", identityAddress);
}

const identityAbi = [
  "function owner() view returns(address)",
  "function registrar() view returns(address)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function baseURI() view returns(string)",
  "function MAX_IDENTITIES() view returns(uint256)",
  "function MIN_NAME_LENGTH() view returns(uint256)",
  "function MAX_NAME_LENGTH() view returns(uint256)",
];
const identity = new ethers.Contract(identityAddress, identityAbi, provider);
const summary = {
  KEYIdentity: identityAddress,
  owner: await identity.owner(),
  registrar: await identity.registrar(),
  name: await identity.name(),
  symbol: await identity.symbol(),
  baseURI: await identity.baseURI(),
  maxIdentities: String(await identity.MAX_IDENTITIES()),
  minNameLength: String(await identity.MIN_NAME_LENGTH()),
  maxNameLength: String(await identity.MAX_NAME_LENGTH()),
};

console.log("");
console.log("KEYIdentity deployment summary");
console.log(JSON.stringify(summary, null, 2));
