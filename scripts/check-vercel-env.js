import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

const candidates = [".env.vercel", ".env.mainnet", ".env.production", ".env"];
const envFile = candidates.find((file) => fs.existsSync(file));
const parsed = envFile ? dotenv.parse(fs.readFileSync(envFile)) : {};
const env = { ...process.env, ...parsed };

function requireValue(name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for Vercel frontend`);
  return value;
}

function requireUrl(name) {
  const value = requireValue(name);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function requireAddress(name) {
  const value = requireValue(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(value);
}

const backendUrl = requireUrl("VITE_BACKEND_URL");
const chainId = Number(requireValue("VITE_CHAIN_ID"));
if (chainId !== 1) throw new Error("VITE_CHAIN_ID must be 1 for mainnet Vercel deploy");

if (!backendUrl.toString().startsWith("https://")) {
  throw new Error("VITE_BACKEND_URL should be HTTPS for Vercel/mainnet");
}

const localPattern = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;
if (localPattern.test(backendUrl.toString())) {
  throw new Error("VITE_BACKEND_URL must not be localhost for Vercel/mainnet");
}

const mintGate = requireAddress("VITE_MINT_GATE_ADDRESS");
const token = requireAddress("VITE_KEY_TOKEN_ADDRESS");
const vault = requireAddress("VITE_TREASURY_VAULT_ADDRESS");
const lpReserve = requireAddress("VITE_LP_RESERVE_ADDRESS");

console.log("Vercel frontend env check passed.");
console.log("env file:", envFile || "shell");
console.log("backend:", backendUrl.toString());
console.log("chainId:", chainId);
console.log("mintGate:", mintGate);
console.log("token:", token);
console.log("vault:", vault);
console.log("lpReserve:", lpReserve);
