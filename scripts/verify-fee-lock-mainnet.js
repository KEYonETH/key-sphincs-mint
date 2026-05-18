import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const stateFile = "deployments/mainnet-fee-lock-v4.json";
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

function value(name, fallback = "") {
  return String(env[name] || fallback || "").trim();
}

function requireAddress(name, fallback = "") {
  const candidate = value(name, fallback);
  if (!ethers.isAddress(candidate)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(candidate);
}

function addressList(name, fallback = []) {
  const raw = value(name);
  const items = raw ? raw.split(",") : fallback;
  return items.map((item) => item.trim()).filter(Boolean).map((item) => ethers.getAddress(item));
}

function runVerify(label, contract, address, args) {
  console.log("");
  console.log(`Verifying ${label}: ${address}`);
  fs.mkdirSync("tmp", { recursive: true });
  const argsPath = `tmp/verify-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-mainnet.mjs`;
  fs.writeFileSync(argsPath, `export default ${JSON.stringify(args, null, 2)};\n`);
  const commandArgs = [
    "hardhat",
    "--network",
    "mainnet",
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

if (!value("ETHERSCAN_API_KEY")) throw new Error("ETHERSCAN_API_KEY is required");

const owner = requireAddress("CONTRACT_OWNER_ADDRESS");
const token = requireAddress("VITE_KEY_TOKEN_ADDRESS");
const backendSigner = requireAddress("BACKEND_SIGNER_ADDRESS");
const lockVault = requireAddress("KEY_TREASURY_LOCK_VAULT_ADDRESS", state.KEYTreasuryLockVault);
const gateV4 = requireAddress("KEY_MINT_GATE_V4_ADDRESS", state.KEYMintGateV4);
const oldMintGate = requireAddress("OLD_MINT_GATE_ADDRESS", state.oldMintGate);
const legacyGates = addressList("LEGACY_MINT_GATE_ADDRESSES", state.legacyMintGatesForEnv || []);
const additionalLegacy = legacyGates.filter((gate) => gate.toLowerCase() !== oldMintGate.toLowerCase());

console.log(`Using ${envFile} for fee-lock verification.`);
console.log("owner:", owner);
console.log("token:", token);
console.log("lockVault:", lockVault);
console.log("gateV4:", gateV4);
console.log("oldMintGate:", oldMintGate);
console.log("additionalLegacy:", additionalLegacy.join(", ") || "(none)");

runVerify("KEYTreasuryLockVault", "contracts/KEYTreasuryLockVault.sol:KEYTreasuryLockVault", lockVault, [owner]);
runVerify("KEYMintGateV4", "contracts/KEYMintGateV4.sol:KEYMintGateV4", gateV4, [token, lockVault, backendSigner, oldMintGate, additionalLegacy]);

console.log("");
console.log("Fee-lock verification commands completed.");
