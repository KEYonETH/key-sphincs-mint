import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { ethers } from "ethers";

const networkName = process.argv[2] || "sepolia";
const envFile = networkName === "mainnet" && fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const env = { ...process.env, ...parsed };
const deploymentFile = `deployments/${networkName}-keyspace-v2.json`;
const deployment = fs.existsSync(deploymentFile) ? JSON.parse(fs.readFileSync(deploymentFile, "utf8")) : {};

function value(name, fallback = "") {
  return env[name] || fallback || "";
}

function requireAddress(name, fallback = "") {
  const candidate = value(name, fallback);
  if (!candidate || !ethers.isAddress(candidate)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(candidate);
}

function privateKey(name) {
  const raw = value(name);
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function addressList(name, fallback = []) {
  const raw = value(name);
  const items = raw ? raw.split(",") : fallback;
  return items.map((item) => item.trim()).filter(Boolean).map((item) => ethers.getAddress(item));
}

function deployerAddress() {
  const key = networkName === "mainnet" ? privateKey("MAINNET_PRIVATE_KEY") : privateKey("SEPOLIA_PRIVATE_KEY");
  if (!key) throw new Error(`${networkName === "mainnet" ? "MAINNET_PRIVATE_KEY" : "SEPOLIA_PRIVATE_KEY"} is required to infer constructor fallbacks`);
  return new ethers.Wallet(key).address;
}

function backendSignerAddress(fallback) {
  const configured = value("BACKEND_SIGNER_ADDRESS");
  if (configured) return requireAddress("BACKEND_SIGNER_ADDRESS");
  const signerKey = privateKey("SIGNER_PRIVATE_KEY");
  if (signerKey) return new ethers.Wallet(signerKey).address;
  return fallback;
}

function runVerify(label, contract, address, args) {
  console.log("");
  console.log(`Verifying ${label}: ${address}`);
  fs.mkdirSync("tmp", { recursive: true });
  const argsPath = `tmp/verify-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${networkName}.mjs`;
  fs.writeFileSync(argsPath, `export default ${JSON.stringify(args, null, 2)};\n`);
  const commandArgs = [
    "hardhat",
    "--network",
    networkName,
    "verify",
    "etherscan",
    "--contract",
    contract,
    "--constructor-args-path",
    argsPath,
    address,
  ];
  const result = spawnSync("npx", commandArgs, { encoding: "utf8", env, shell: process.platform === "win32" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (output.trim()) console.log(output.trim());
  if (result.error) console.log(String(result.error));
  if (result.status !== 0) {
    if (/already verified|verification may still succeed|contract verified successfully|already has bytecode/i.test(output)) {
      console.log(`${label}: verification appears submitted/already verified; continuing.`);
      return;
    }
    throw new Error(`${label} verification failed`);
  }
}

if (!value("ETHERSCAN_API_KEY")) {
  throw new Error("ETHERSCAN_API_KEY is required for Etherscan verification");
}

const fallback = deployerAddress();
const owner = requireAddress("CONTRACT_OWNER_ADDRESS", fallback);
const lpReserveRecipient = requireAddress("LP_RESERVE_RECIPIENT", fallback);
const treasuryReserveRecipient = requireAddress("TREASURY_RESERVE_RECIPIENT", fallback);
const backendSigner = backendSignerAddress(fallback);
const token = requireAddress("VITE_KEY_TOKEN_ADDRESS");
const vault = requireAddress("VITE_TREASURY_VAULT_ADDRESS");
const gateV3 = requireAddress("MINT_GATE_ADDRESS", value("VITE_MINT_GATE_ADDRESS", deployment.KEYMintGateV3));
const identity = requireAddress("VITE_KEY_IDENTITY_ADDRESS", deployment.KEYIdentity);
const registrarV3 = requireAddress("VITE_KEY_REGISTRAR_ADDRESS", deployment.KEYSpaceRegistrarActive || deployment.KEYSpaceRegistrarV3);
const market = requireAddress("VITE_KEY_MARKET_ADDRESS", deployment.KEYSpaceMarket);
const legacyGates = addressList("LEGACY_MINT_GATE_ADDRESSES", [
  "0x41EdE34b9420da46b2E5f2C9131d8882eCEAD61F",
  "0x0Aea42a86D53a3B7eA6f68BC4Cd8c75c52517EF6",
]);
const primaryLegacyGate = legacyGates[0];
const additionalLegacyGates = legacyGates.slice(1);
const baseURI = value("KEY_IDENTITY_BASE_URI", "https://api.key-sphincs.xyz/api/keyspace/metadata/");

console.log(`Using ${envFile} for ${networkName} verification.`);
console.log("Constructor args:");
console.log("owner:", owner);
console.log("lpReserveRecipient:", lpReserveRecipient);
console.log("treasuryReserveRecipient:", treasuryReserveRecipient);
console.log("backendSigner:", backendSigner);
console.log("legacyGates:", legacyGates.join(", "));

runVerify("KEYTreasuryVault", "contracts/KEYTreasuryVault.sol:KEYTreasuryVault", vault, [owner]);
runVerify("KEYToken", "contracts/KEYToken.sol:KEYToken", token, [lpReserveRecipient, treasuryReserveRecipient]);
runVerify("KEYMintGateV3", "contracts/KEYMintGateV3.sol:KEYMintGateV3", gateV3, [token, vault, backendSigner, primaryLegacyGate, additionalLegacyGates]);
runVerify("KEYIdentity", "contracts/KEYIdentity.sol:KEYIdentity", identity, [owner, baseURI]);
runVerify("KEYSpaceRegistrarV3", "contracts/KEYSpaceRegistrarV3.sol:KEYSpaceRegistrarV3", registrarV3, [owner, token, identity, gateV3, legacyGates]);
runVerify("KEYSpaceMarket", "contracts/KEYSpaceMarket.sol:KEYSpaceMarket", market, [owner, identity]);

console.log("");
console.log("All verification commands completed.");
