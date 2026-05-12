import "dotenv/config";
import { network } from "hardhat";

const { ethers } = await network.create();

function requiredAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(value);
}

function signerAddressFromEnv(deployerAddress) {
  const rawPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  const privateKey = rawPrivateKey && !rawPrivateKey.startsWith("0x") ? `0x${rawPrivateKey}` : rawPrivateKey;
  if (!privateKey) return deployerAddress;
  return new ethers.Wallet(privateKey).address;
}

const [deployer] = await ethers.getSigners();
const chain = await ethers.provider.getNetwork();

const lpReserveRecipient = requiredAddress("LP_RESERVE_RECIPIENT", deployer.address);
const treasuryReserveRecipient = requiredAddress("TREASURY_RESERVE_RECIPIENT", deployer.address);
const backendSignerAddress = requiredAddress("BACKEND_SIGNER_ADDRESS", signerAddressFromEnv(deployer.address));
const ownerAddress = requiredAddress("CONTRACT_OWNER_ADDRESS", deployer.address);

console.log("Deploying KEY testnet contracts");
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

if (ownerAddress !== deployer.address) {
  await (await token.transferOwnership(ownerAddress)).wait();
  await (await gate.transferOwnership(ownerAddress)).wait();
}

console.log("");
console.log("Copy this into .env for Sepolia testing:");
console.log("--------------------------------------------------");
console.log(`CHAIN_ID=${chain.chainId}`);
console.log(`VITE_CHAIN_ID=${chain.chainId}`);
console.log(`MINT_GATE_ADDRESS=${await gate.getAddress()}`);
console.log(`VITE_MINT_GATE_ADDRESS=${await gate.getAddress()}`);
console.log(`VITE_KEY_TOKEN_ADDRESS=${await token.getAddress()}`);
console.log(`VITE_TREASURY_VAULT_ADDRESS=${await vault.getAddress()}`);
console.log(`VITE_LP_RESERVE_ADDRESS=${lpReserveRecipient}`);
console.log(`SPHINCS_VERIFY_MODE=preview`);
console.log("--------------------------------------------------");
console.log("");
console.log("Important:");
console.log("- SIGNER_PRIVATE_KEY in backend .env must belong to the backend signer address above.");
console.log("- For quick Sepolia testing, SIGNER_PRIVATE_KEY can be the same as SEPOLIA_PRIVATE_KEY.");
console.log("- For mainnet, use a separate backend signer wallet.");
