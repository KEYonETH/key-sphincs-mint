import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { ethers } from "ethers";

const networkName = process.argv[2] || "sepolia";
const envFile = networkName === "mainnet" && fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const env = { ...process.env, ...parsed };

function value(name, fallback = "") {
  return env[name] || fallback;
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
  const command = [
    "npx",
    "hardhat",
    "--network",
    networkName,
    "verify",
    "etherscan",
    "--contract",
    contract,
    address,
    ...args,
  ].join(" ");
  const result = spawnSync(
    command,
    { encoding: "utf8", env, shell: true }
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (output.trim()) console.log(output.trim());
  if (result.error) console.log(String(result.error));
  if (result.status !== 0) {
    if (
      /already verified/i.test(output) ||
      /Verification may still succeed/i.test(output) ||
      /Contract verified successfully/i.test(output)
    ) {
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
const gate = requireAddress("MINT_GATE_ADDRESS", value("VITE_MINT_GATE_ADDRESS"));

console.log(`Using ${envFile} for ${networkName} verification.`);
console.log("Constructor args:");
console.log("owner:", owner);
console.log("lpReserveRecipient:", lpReserveRecipient);
console.log("treasuryReserveRecipient:", treasuryReserveRecipient);
console.log("backendSigner:", backendSigner);

runVerify("KEYTreasuryVault", "contracts/KEYTreasuryVault.sol:KEYTreasuryVault", vault, [owner]);
runVerify("KEYToken", "contracts/KEYToken.sol:KEYToken", token, [lpReserveRecipient, treasuryReserveRecipient]);
runVerify("KEYMintGate", "contracts/KEYMintGate.sol:KEYMintGate", gate, [token, vault, backendSigner]);

console.log("");
console.log("All verification commands completed.");
