import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const envFile = fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };

const mappings = {
  VITE_MINT_GATE_ADDRESS: "MINT_GATE_ADDRESS",
  VITE_KEY_TOKEN_ADDRESS: "KEY_TOKEN_ADDRESS",
  VITE_TREASURY_VAULT_ADDRESS: "TREASURY_VAULT_ADDRESS",
  VITE_LP_RESERVE_ADDRESS: "LP_RESERVE_RECIPIENT",
  VITE_TREASURY_RESERVE_ADDRESS: "TREASURY_RESERVE_RECIPIENT",
  VITE_KEY_IDENTITY_ADDRESS: "KEY_IDENTITY_ADDRESS",
  VITE_KEY_REGISTRAR_ADDRESS: "KEY_REGISTRAR_ADDRESS",
  VITE_KEY_MARKET_ADDRESS: "KEY_MARKET_ADDRESS",
  VITE_UNISWAP_V4_POOL_ID: "UNISWAP_V4_POOL_ID",
  VITE_UNISWAP_V4_HOOK_ADDRESS: "UNISWAP_V4_HOOK_ADDRESS",
  VITE_BACKEND_URL: "VITE_BACKEND_URL",
};

function run(args, input = "") {
  return spawnSync("npx", ["vercel", ...args], {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

for (const [vercelName, sourceName] of Object.entries(mappings)) {
  const value = String(env[vercelName] || env[sourceName] || "").trim();
  if (!value) continue;

  console.log(`sync ${vercelName}`);
  run(["env", "rm", vercelName, "production", "-y"]);
  const added = run(["env", "add", vercelName, "production"], `${value}\n`);
  const output = `${added.stdout || ""}\n${added.stderr || ""}`;
  if (added.status !== 0 && !/already exists/i.test(output)) {
    console.error(output.trim());
    throw new Error(`failed to sync ${vercelName}`);
  }
}

console.log("Vercel public env sync complete.");
