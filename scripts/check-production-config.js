import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = fs.existsSync(".env.production") ? ".env.production" : ".env";
const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const env = { ...process.env, ...parsed };

function requireValue(name) {
  const value = env[name];
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function requireAddress(name) {
  const value = requireValue(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
}

function requireUrl(name) {
  const value = requireValue(name);
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

const backendUrl = requireUrl("VITE_BACKEND_URL");
const corsOrigin = requireUrl("CORS_ORIGIN");
const chainId = Number(requireValue("CHAIN_ID"));
const viteChainId = Number(requireValue("VITE_CHAIN_ID"));
if (chainId !== viteChainId) throw new Error("CHAIN_ID and VITE_CHAIN_ID must match");
if (![1, 11155111].includes(chainId)) throw new Error("CHAIN_ID must be 1 for mainnet or 11155111 for Sepolia");

if (chainId === 1) {
  const localPattern = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;
  if (!backendUrl.startsWith("https://")) throw new Error("VITE_BACKEND_URL must use HTTPS on mainnet");
  if (!corsOrigin.startsWith("https://")) throw new Error("CORS_ORIGIN must use HTTPS on mainnet");
  if (localPattern.test(backendUrl) || localPattern.test(corsOrigin)) {
    throw new Error("Mainnet production URLs must not use localhost");
  }
}

const mintGate = requireAddress("MINT_GATE_ADDRESS");
const viteMintGate = requireAddress("VITE_MINT_GATE_ADDRESS");
if (mintGate !== viteMintGate) throw new Error("MINT_GATE_ADDRESS and VITE_MINT_GATE_ADDRESS must match");

requireAddress("VITE_KEY_TOKEN_ADDRESS");
requireAddress("VITE_TREASURY_VAULT_ADDRESS");
requireValue("SIGNER_PRIVATE_KEY");

if (requireValue("SPHINCS_VERIFY_MODE") !== "command") {
  throw new Error("SPHINCS_VERIFY_MODE must be command in production");
}
requireValue("SPHINCS_VERIFY_COMMAND");

if (env.NODE_ENV && env.NODE_ENV !== "production") {
  throw new Error("NODE_ENV should be production for production deployment");
}

console.log("Production config check passed.");
console.log("env file:", envFile);
console.log("backend:", backendUrl);
console.log("frontend origin:", corsOrigin);
console.log("chainId:", chainId);
console.log("mintGate:", mintGate);
