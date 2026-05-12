import "dotenv/config";
import { network } from "hardhat";

const { ethers } = await network.create();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required for mainnet deploy`);
  return value.trim();
}

function envPrivateKey(name) {
  const value = requireEnv(name);
  return value.startsWith("0x") ? value : `0x${value}`;
}

function requiredAddress(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
}

function signerAddressFromEnv() {
  return new ethers.Wallet(envPrivateKey("SIGNER_PRIVATE_KEY")).address;
}

const [deployer] = await ethers.getSigners();
const chain = await ethers.provider.getNetwork();

if (chain.chainId !== 1n) {
  throw new Error(`Refusing mainnet deploy on chainId ${chain.chainId}. Expected chainId 1.`);
}

if (process.env.MAINNET_DEPLOY_CONFIRM !== "DEPLOY_KEY_MAINNET") {
  throw new Error("Set MAINNET_DEPLOY_CONFIRM=DEPLOY_KEY_MAINNET to confirm an intentional Ethereum mainnet deploy.");
}

const ownerAddress = requiredAddress("CONTRACT_OWNER_ADDRESS");
const lpReserveRecipient = requiredAddress("LP_RESERVE_RECIPIENT");
const treasuryReserveRecipient = requiredAddress("TREASURY_RESERVE_RECIPIENT");
const backendSignerAddress = requiredAddress("BACKEND_SIGNER_ADDRESS");
const signerFromPrivateKey = signerAddressFromEnv();

if (backendSignerAddress !== signerFromPrivateKey) {
  throw new Error(`BACKEND_SIGNER_ADDRESS ${backendSignerAddress} does not match SIGNER_PRIVATE_KEY signer ${signerFromPrivateKey}`);
}

for (const [name, address] of [
  ["CONTRACT_OWNER_ADDRESS", ownerAddress],
  ["LP_RESERVE_RECIPIENT", lpReserveRecipient],
  ["TREASURY_RESERVE_RECIPIENT", treasuryReserveRecipient],
  ["BACKEND_SIGNER_ADDRESS", backendSignerAddress],
]) {
  if (address === deployer.address) {
    throw new Error(`${name} must not be the deployer wallet on mainnet. Use separate production custody.`);
  }
}

console.log("Deploying KEY mainnet contracts");
console.log("Network chainId:", chain.chainId.toString());
console.log("Deployer:", deployer.address);
console.log("Contract owner:", ownerAddress);
console.log("Backend signer:", backendSignerAddress);
console.log("LP reserve recipient:", lpReserveRecipient);
console.log("Treasury reserve recipient:", treasuryReserveRecipient);

const vault = await ethers.deployContract("KEYTreasuryVault", [ownerAddress]);
await vault.waitForDeployment();
console.log("KEYTreasuryVault:", await vault.getAddress());

const token = await ethers.deployContract("KEYToken", [lpReserveRecipient, treasuryReserveRecipient]);
await token.waitForDeployment();
console.log("KEYToken:", await token.getAddress());

const gate = await ethers.deployContract("KEYMintGate", [
  await token.getAddress(),
  await vault.getAddress(),
  backendSignerAddress,
]);
await gate.waitForDeployment();
console.log("KEYMintGate:", await gate.getAddress());

await (await token.setMintGate(await gate.getAddress())).wait();
await (await vault.setMintGate(await gate.getAddress())).wait();
await (await token.transferOwnership(ownerAddress)).wait();
await (await gate.transferOwnership(ownerAddress)).wait();

console.log("");
console.log("Copy this into production backend/frontend environment:");
console.log("--------------------------------------------------");
console.log("CHAIN_ID=1");
console.log("VITE_CHAIN_ID=1");
console.log(`MINT_GATE_ADDRESS=${await gate.getAddress()}`);
console.log(`VITE_MINT_GATE_ADDRESS=${await gate.getAddress()}`);
console.log(`VITE_KEY_TOKEN_ADDRESS=${await token.getAddress()}`);
console.log(`VITE_TREASURY_VAULT_ADDRESS=${await vault.getAddress()}`);
console.log(`VITE_LP_RESERVE_ADDRESS=${lpReserveRecipient}`);
console.log("SPHINCS_VERIFY_MODE=command");
console.log("--------------------------------------------------");
console.log("");
console.log("Next:");
console.log("1. Verify contracts on Etherscan.");
console.log("2. Start production backend with SIGNER_PRIVATE_KEY that matches BACKEND_SIGNER_ADDRESS.");
console.log("3. Build frontend with the VITE_* mainnet addresses.");
