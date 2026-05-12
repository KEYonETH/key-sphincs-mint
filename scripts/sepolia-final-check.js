import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

const parsed = fs.existsSync(".env") ? dotenv.parse(fs.readFileSync(".env")) : {};
const env = { ...process.env, ...parsed };

function requireValue(name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`${name} is missing`);
  return value.trim();
}

function requireAddress(name) {
  const value = requireValue(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address`);
  return ethers.getAddress(value);
}

const rpcUrl = requireValue("SEPOLIA_RPC_URL");
const provider = new ethers.JsonRpcProvider(rpcUrl);
const chain = await provider.getNetwork();
if (chain.chainId !== 11155111n) throw new Error(`Expected Sepolia chainId 11155111, got ${chain.chainId}`);

const token = requireAddress("VITE_KEY_TOKEN_ADDRESS");
const vault = requireAddress("VITE_TREASURY_VAULT_ADDRESS");
const gate = requireAddress("MINT_GATE_ADDRESS");
const viteGate = requireAddress("VITE_MINT_GATE_ADDRESS");
if (gate !== viteGate) throw new Error("MINT_GATE_ADDRESS and VITE_MINT_GATE_ADDRESS do not match");

for (const [name, address] of [
  ["KEYToken", token],
  ["KEYTreasuryVault", vault],
  ["KEYMintGate", gate],
]) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  console.log(`${name}: ${address} bytecode=${(code.length - 2) / 2} bytes`);
}

const gateAbi = [
  "function token() view returns (address)",
  "function treasuryVault() view returns (address)",
  "function attestationSigner() view returns (address)",
  "function MINT_PRICE() view returns (uint256)",
];
const gateContract = new ethers.Contract(gate, gateAbi, provider);
const [gateToken, gateVault, attestationSigner, mintPrice] = await Promise.all([
  gateContract.token(),
  gateContract.treasuryVault(),
  gateContract.attestationSigner(),
  gateContract.MINT_PRICE(),
]);

if (ethers.getAddress(gateToken) !== token) throw new Error("Mint gate token does not match VITE_KEY_TOKEN_ADDRESS");
if (ethers.getAddress(gateVault) !== vault) throw new Error("Mint gate vault does not match VITE_TREASURY_VAULT_ADDRESS");

const signerKey = requireValue("SIGNER_PRIVATE_KEY");
const signerAddress = new ethers.Wallet(signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`).address;
if (ethers.getAddress(attestationSigner) !== signerAddress) {
  throw new Error(`Backend signer ${signerAddress} does not match gate attestation signer ${attestationSigner}`);
}

console.log("Mint price:", ethers.formatEther(mintPrice), "ETH");
console.log("Attestation signer:", attestationSigner);
console.log("Sepolia final check passed.");
