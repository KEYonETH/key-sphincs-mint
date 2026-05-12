import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = ".env.mainnet";

if (!fs.existsSync(envFile)) {
  console.error("Mainnet readiness check failed.");
  console.error("Missing .env.mainnet. Create it from .env.mainnet.example first:");
  console.error("Copy-Item .env.mainnet.example .env.mainnet");
  process.exit(1);
}

const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const errors = [];
const warnings = [];

function value(name) {
  return String(env[name] || "").trim();
}

function requireValue(name) {
  const v = value(name);
  if (!v) errors.push(`${name} is required`);
  return v;
}

function requireUrl(name) {
  const v = requireValue(name);
  if (!v) return "";
  try {
    const url = new URL(v);
    if (url.protocol !== "https:") warnings.push(`${name} should use HTTPS`);
    return url.toString();
  } catch {
    errors.push(`${name} must be a valid URL`);
    return "";
  }
}

function requireAddress(name) {
  const v = requireValue(name);
  if (!v) return "";
  if (!ethers.isAddress(v)) {
    errors.push(`${name} must be a valid Ethereum address`);
    return "";
  }
  return ethers.getAddress(v);
}

function requirePrivateKey(name) {
  const raw = requireValue(name);
  if (!raw) return null;
  const privateKey = raw.startsWith("0x") ? raw : `0x${raw}`;
  try {
    return new ethers.Wallet(privateKey);
  } catch {
    errors.push(`${name} must be a valid private key`);
    return null;
  }
}

requireUrl("MAINNET_RPC_URL");
requireValue("ETHERSCAN_API_KEY");

const deployer = requirePrivateKey("MAINNET_PRIVATE_KEY");
const backendSigner = requirePrivateKey("SIGNER_PRIVATE_KEY");

const owner = requireAddress("CONTRACT_OWNER_ADDRESS");
const lpReserve = requireAddress("LP_RESERVE_RECIPIENT");
const treasuryReserve = requireAddress("TREASURY_RESERVE_RECIPIENT");
const backendSignerAddress = requireAddress("BACKEND_SIGNER_ADDRESS");

if (value("MAINNET_DEPLOY_CONFIRM") !== "DEPLOY_KEY_MAINNET") {
  errors.push("MAINNET_DEPLOY_CONFIRM must be DEPLOY_KEY_MAINNET when you are ready to deploy");
}

if (value("SPHINCS_VERIFY_MODE") !== "command") {
  errors.push("SPHINCS_VERIFY_MODE must be command for mainnet");
}

const verifyCommand = requireValue("SPHINCS_VERIFY_COMMAND");
if (verifyCommand && !verifyCommand.includes("verify_sphincsminus.py")) {
  warnings.push("SPHINCS_VERIFY_COMMAND should use backend/verifier/verify_sphincsminus.py");
}

if (!fs.existsSync("backend/vendor/sphincsminus/sphincs_minus.py")) {
  errors.push("backend/vendor/sphincsminus/sphincs_minus.py is missing");
}

if (!fs.existsSync("backend/verifier/verify_sphincsminus.py")) {
  errors.push("backend/verifier/verify_sphincsminus.py is missing");
}

if (backendSigner && backendSignerAddress && ethers.getAddress(backendSigner.address) !== backendSignerAddress) {
  errors.push("BACKEND_SIGNER_ADDRESS does not match SIGNER_PRIVATE_KEY");
}

if (deployer) {
  const deployerAddress = ethers.getAddress(deployer.address);
  for (const [label, address] of [
    ["CONTRACT_OWNER_ADDRESS", owner],
    ["LP_RESERVE_RECIPIENT", lpReserve],
    ["TREASURY_RESERVE_RECIPIENT", treasuryReserve],
    ["BACKEND_SIGNER_ADDRESS", backendSignerAddress],
  ]) {
    if (address && address === deployerAddress) {
      errors.push(`${label} must not be the deployer wallet`);
    }
  }
}

if (backendSignerAddress) {
  for (const [label, address] of [
    ["CONTRACT_OWNER_ADDRESS", owner],
    ["LP_RESERVE_RECIPIENT", lpReserve],
    ["TREASURY_RESERVE_RECIPIENT", treasuryReserve],
  ]) {
    if (address && address === backendSignerAddress) {
      errors.push(`BACKEND_SIGNER_ADDRESS should be separate from ${label}`);
    }
  }
}

if (owner && lpReserve && treasuryReserve && owner === lpReserve && owner === treasuryReserve) {
  warnings.push("Owner, LP reserve, and treasury reserve are the same address. This is acceptable only if it is a multisig with a published custody policy.");
}

if (value("VITE_CHAIN_ID") && value("VITE_CHAIN_ID") !== "1") {
  errors.push("VITE_CHAIN_ID must be 1 for mainnet");
}

const frontendUrl = value("VITE_BACKEND_URL");
if (frontendUrl && !frontendUrl.startsWith("https://")) {
  warnings.push("VITE_BACKEND_URL should use HTTPS for mainnet production");
}

const corsOrigin = value("CORS_ORIGIN");
if (corsOrigin && !corsOrigin.startsWith("https://")) {
  warnings.push("CORS_ORIGIN should use HTTPS for mainnet production");
}

console.log("KEY mainnet readiness report");
console.log("env file:", envFile);
if (deployer) console.log("deployer:", ethers.getAddress(deployer.address));
if (backendSignerAddress) console.log("backend signer:", backendSignerAddress);
if (owner) console.log("contract owner:", owner);
if (lpReserve) console.log("LP reserve:", lpReserve);
if (treasuryReserve) console.log("treasury reserve:", treasuryReserve);

if (warnings.length > 0) {
  console.log("");
  console.log("Warnings:");
  for (const warning of warnings) console.log("-", warning);
}

if (errors.length > 0) {
  console.log("");
  console.error("Readiness check failed:");
  for (const error of errors) console.error("-", error);
  process.exit(1);
}

console.log("");
console.log("Mainnet readiness check passed.");
console.log("Next safe commands:");
console.log("npm run contracts:test");
console.log("npm run contracts:deploy:mainnet");
