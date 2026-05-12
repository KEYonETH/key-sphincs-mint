import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateDir = "deployments";
const stateFile = path.join(stateDir, "mainnet.json");

if (!fs.existsSync(envFile)) throw new Error(".env.mainnet is required");
if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

function saveState() {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function requireEnv(name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(name) {
  const value = requireEnv(name);
  return value.startsWith("0x") ? value : `0x${value}`;
}

function address(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
}

function artifact(contractPath) {
  return JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", contractPath), "utf8"));
}

async function deployIfMissing(label, artifactFile, args) {
  if (state[label] && ethers.isAddress(state[label])) {
    const code = await provider.getCode(state[label]);
    if (code !== "0x") {
      console.log(`${label}: ${state[label]} (existing)`);
      return state[label];
    }
    throw new Error(`${label} exists in ${stateFile}, but no code found at ${state[label]}`);
  }

  const art = artifact(artifactFile);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  console.log(`Deploying ${label}...`);
  const contract = await factory.deploy(...args);
  console.log(`${label} tx: ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();
  const deployedAddress = await contract.getAddress();
  state[label] = deployedAddress;
  saveState();
  console.log(`${label}: ${deployedAddress}`);
  return deployedAddress;
}

async function sendIfNeeded(label, fn) {
  if (state[label]) {
    console.log(`${label}: already done`);
    return;
  }
  const tx = await fn();
  console.log(`${label} tx: ${tx.hash}`);
  await tx.wait();
  state[label] = true;
  saveState();
  console.log(`${label}: done`);
}

if (requireEnv("MAINNET_DEPLOY_CONFIRM") !== "DEPLOY_KEY_MAINNET") {
  throw new Error("MAINNET_DEPLOY_CONFIRM must be DEPLOY_KEY_MAINNET");
}

const provider = new ethers.JsonRpcProvider(requireEnv("MAINNET_RPC_URL"));
const wallet = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const ownerAddress = address("CONTRACT_OWNER_ADDRESS");
const lpReserveRecipient = address("LP_RESERVE_RECIPIENT");
const treasuryReserveRecipient = address("TREASURY_RESERVE_RECIPIENT");
const backendSignerAddress = address("BACKEND_SIGNER_ADDRESS");
const backendSignerWallet = new ethers.Wallet(privateKey("SIGNER_PRIVATE_KEY"));

if (ethers.getAddress(backendSignerWallet.address) !== backendSignerAddress) {
  throw new Error("BACKEND_SIGNER_ADDRESS does not match SIGNER_PRIVATE_KEY");
}

for (const [label, addr] of [
  ["CONTRACT_OWNER_ADDRESS", ownerAddress],
  ["LP_RESERVE_RECIPIENT", lpReserveRecipient],
  ["TREASURY_RESERVE_RECIPIENT", treasuryReserveRecipient],
  ["BACKEND_SIGNER_ADDRESS", backendSignerAddress],
]) {
  if (addr === ethers.getAddress(wallet.address)) {
    throw new Error(`${label} must not be the deployer wallet`);
  }
}

console.log("Deploying/resuming KEY mainnet contracts");
console.log("deployer:", wallet.address);
console.log("balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

const vaultAddress = await deployIfMissing("KEYTreasuryVault", "KEYTreasuryVault.sol/KEYTreasuryVault.json", [ownerAddress]);
const tokenAddress = await deployIfMissing("KEYToken", "KEYToken.sol/KEYToken.json", [
  lpReserveRecipient,
  treasuryReserveRecipient,
]);
const gateAddress = await deployIfMissing("KEYMintGate", "KEYMintGate.sol/KEYMintGate.json", [
  tokenAddress,
  vaultAddress,
  backendSignerAddress,
]);

const tokenArtifact = artifact("KEYToken.sol/KEYToken.json");
const vaultArtifact = artifact("KEYTreasuryVault.sol/KEYTreasuryVault.json");
const gateArtifact = artifact("KEYMintGate.sol/KEYMintGate.json");

const token = new ethers.Contract(tokenAddress, tokenArtifact.abi, wallet);
const vault = new ethers.Contract(vaultAddress, vaultArtifact.abi, wallet);
const gate = new ethers.Contract(gateAddress, gateArtifact.abi, wallet);

await sendIfNeeded("tokenMintGateSet", async () => token.setMintGate(gateAddress));

const vaultOwner = ethers.getAddress(await vault.owner());
if (vaultOwner === ethers.getAddress(wallet.address)) {
  await sendIfNeeded("vaultMintGateSet", async () => vault.setMintGate(gateAddress));
} else if (!state.vaultMintGateSet) {
  const currentVaultMintGate = ethers.getAddress(await vault.mintGate());
  if (currentVaultMintGate === gateAddress) {
    state.vaultMintGateSet = true;
    saveState();
    console.log("vaultMintGateSet: already done on-chain");
  } else {
    console.log("vaultMintGateSet: manual owner action required");
    console.log(`vault owner ${vaultOwner} must call KEYTreasuryVault.setMintGate(${gateAddress})`);
  }
}

await sendIfNeeded("tokenOwnershipTransferred", async () => token.transferOwnership(ownerAddress));
await sendIfNeeded("gateOwnershipTransferred", async () => gate.transferOwnership(ownerAddress));

console.log("");
console.log("Mainnet deploy complete.");
console.log("--------------------------------------------------");
console.log("CHAIN_ID=1");
console.log("VITE_CHAIN_ID=1");
console.log(`MINT_GATE_ADDRESS=${gateAddress}`);
console.log(`VITE_MINT_GATE_ADDRESS=${gateAddress}`);
console.log(`VITE_KEY_TOKEN_ADDRESS=${tokenAddress}`);
console.log(`VITE_TREASURY_VAULT_ADDRESS=${vaultAddress}`);
console.log(`VITE_LP_RESERVE_ADDRESS=${lpReserveRecipient}`);
console.log("SPHINCS_VERIFY_MODE=command");
console.log("--------------------------------------------------");
if (!state.vaultMintGateSet) {
  console.log("");
  console.log("Manual action still required before public mint works:");
  console.log(`Call setMintGate(${gateAddress}) on KEYTreasuryVault ${vaultAddress} from owner ${vaultOwner}.`);
}
