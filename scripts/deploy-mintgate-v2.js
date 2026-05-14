import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";
const stateFile = path.join("deployments", "mainnet-mintgate-v2.json");

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

function optionalValue(...names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function privateKey(name) {
  const value = requireValue(name);
  return value.startsWith("0x") ? value : `0x${value}`;
}

function optionalPrivateKey(name) {
  const value = String(env[name] || "").trim();
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function address(name, fallback = "") {
  const value = String(env[name] || fallback || "").trim();
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

function encodeSetMintGate(targetAddress) {
  const iface = new ethers.Interface(["function setMintGate(address gate)"]);
  return iface.encodeFunctionData("setMintGate", [targetAddress]);
}

const provider = new ethers.JsonRpcProvider(requireValue("MAINNET_RPC_URL"), 1);
const deployer = new ethers.Wallet(privateKey("MAINNET_PRIVATE_KEY"), provider);
const ownerPrivateKey = optionalPrivateKey("CONTRACT_OWNER_PRIVATE_KEY");
const ownerSigner = ownerPrivateKey ? new ethers.Wallet(ownerPrivateKey, provider) : null;

const network = await provider.getNetwork();
if (network.chainId !== 1n) throw new Error(`Expected mainnet chainId 1, got ${network.chainId}`);

const tokenAddress = address("KEY_TOKEN_ADDRESS", optionalValue("VITE_KEY_TOKEN_ADDRESS"));
const vaultAddress = address("TREASURY_VAULT_ADDRESS", optionalValue("VITE_TREASURY_VAULT_ADDRESS"));
const backendSignerAddress = address("BACKEND_SIGNER_ADDRESS");
const contractOwnerAddress = address("CONTRACT_OWNER_ADDRESS");

const gateArtifact = artifact("KEYMintGate.sol/KEYMintGate.json");
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
const gateAbi = [
  "function owner() view returns(address)",
  "function transferOwnership(address newOwner)",
  "function token() view returns(address)",
  "function treasuryVault() view returns(address)",
  "function attestationSigner() view returns(address)",
  "function WALLET_CAP() view returns(uint256)",
  "function MINT_PRICE() view returns(uint256)",
];

console.log("Deploying KEYMintGateV2 replacement");
console.log("deployer:", deployer.address);
console.log("contract owner:", contractOwnerAddress);
console.log("token:", tokenAddress);
console.log("vault:", vaultAddress);
console.log("backend signer:", backendSignerAddress);
console.log("deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

let gateAddress = state.KEYMintGateV2;
if (gateAddress) {
  const code = await provider.getCode(gateAddress);
  if (code === "0x") throw new Error(`state has KEYMintGateV2=${gateAddress}, but no code exists there`);
  console.log("KEYMintGateV2:", gateAddress, "(existing)");
} else {
  const factory = new ethers.ContractFactory(gateArtifact.abi, gateArtifact.bytecode, deployer);
  const gate = await factory.deploy(tokenAddress, vaultAddress, backendSignerAddress);
  await waitTx("deploy KEYMintGateV2", gate.deploymentTransaction());
  gateAddress = await gate.getAddress();
  state.KEYMintGateV2 = gateAddress;
  state.KEYMintGateV2DeployTx = gate.deploymentTransaction().hash;
  saveState();
  console.log("KEYMintGateV2:", gateAddress);
}

const gate = new ethers.Contract(gateAddress, gateAbi, deployer);
const token = new ethers.Contract(tokenAddress, tokenAbi, provider);
const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);

const [walletCap, mintPrice, gateToken, gateVault, gateSigner] = await Promise.all([
  gate.WALLET_CAP(),
  gate.MINT_PRICE(),
  gate.token(),
  gate.treasuryVault(),
  gate.attestationSigner(),
]);

if (walletCap !== 1n) throw new Error(`KEYMintGateV2 wallet cap is ${walletCap}, expected 1`);
if (ethers.getAddress(gateToken) !== tokenAddress) throw new Error("KEYMintGateV2 token mismatch");
if (ethers.getAddress(gateVault) !== vaultAddress) throw new Error("KEYMintGateV2 vault mismatch");
if (ethers.getAddress(gateSigner) !== backendSignerAddress) throw new Error("KEYMintGateV2 backend signer mismatch");

let gateOwner = ethers.getAddress(await gate.owner());
if (gateOwner === ethers.getAddress(deployer.address) && gateOwner !== contractOwnerAddress) {
  await waitTx("transfer KEYMintGateV2 ownership", await gate.transferOwnership(contractOwnerAddress));
  gateOwner = ethers.getAddress(await gate.owner());
  state.KEYMintGateV2OwnershipTransferred = true;
  saveState();
}

const tokenOwner = ethers.getAddress(await token.owner());
const vaultOwner = ethers.getAddress(await vault.owner());
const currentTokenGate = ethers.getAddress(await token.mintGate());
const currentVaultGate = ethers.getAddress(await vault.mintGate());
const activationSigner = ownerSigner && ethers.getAddress(ownerSigner.address) === contractOwnerAddress
  ? ownerSigner
  : ethers.getAddress(deployer.address) === contractOwnerAddress
    ? deployer
    : null;

if (activationSigner && tokenOwner === contractOwnerAddress && currentTokenGate !== gateAddress) {
  const writableToken = new ethers.Contract(tokenAddress, tokenAbi, activationSigner);
  await waitTx("activate token mint gate", await writableToken.setMintGate(gateAddress));
  state.tokenMintGateSetToV2 = true;
  saveState();
}

if (activationSigner && vaultOwner === contractOwnerAddress && currentVaultGate !== gateAddress) {
  const writableVault = new ethers.Contract(vaultAddress, vaultAbi, activationSigner);
  await waitTx("activate vault mint gate", await writableVault.setMintGate(gateAddress));
  state.vaultMintGateSetToV2 = true;
  saveState();
}

const nextTokenGate = ethers.getAddress(await token.mintGate());
const nextVaultGate = ethers.getAddress(await vault.mintGate());
const active = nextTokenGate === gateAddress && nextVaultGate === gateAddress;
state.active = active;
state.updatedAt = new Date().toISOString();
saveState();

console.log("");
console.log("KEYMintGateV2 deployment summary");
console.log("KEYMintGateV2:", gateAddress);
console.log("WALLET_CAP:", String(walletCap));
console.log("MINT_PRICE:", ethers.formatEther(mintPrice), "ETH");
console.log("owner:", gateOwner);
console.log("token.mintGate:", nextTokenGate);
console.log("vault.mintGate:", nextVaultGate);
console.log("active:", active);

if (!active) {
  console.log("");
  console.log("Owner action required to activate V2:");
  console.log("owner:", contractOwnerAddress);
  console.log("token setMintGate target:", tokenAddress);
  console.log("token setMintGate calldata:", encodeSetMintGate(gateAddress));
  console.log("vault setMintGate target:", vaultAddress);
  console.log("vault setMintGate calldata:", encodeSetMintGate(gateAddress));
  console.log("");
  console.log("After both owner transactions confirm, set MINT_GATE_ADDRESS and VITE_MINT_GATE_ADDRESS to:");
  console.log(gateAddress);
}
