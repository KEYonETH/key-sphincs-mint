import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const envFile = fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const remotePath = process.env.VPS_APP_PATH || "/var/www/key-sphincs-mint";
const remoteHost = process.env.VPS_SSH_HOST || "key-vps";

const keys = [
  "CHAIN_ID",
  "MAINNET_RPC_URL",
  "RPC_URL",
  "SIGNER_PRIVATE_KEY",
  "BACKEND_SIGNER_ADDRESS",
  "CONTRACT_OWNER_ADDRESS",
  "MINT_GATE_ADDRESS",
  "VITE_MINT_GATE_ADDRESS",
  "KEY_MINT_GATE_ADDRESS",
  "LEGACY_MINT_GATE_ADDRESSES",
  "LEGACY_TREASURY_VAULT_ADDRESSES",
  "KEY_TOKEN_ADDRESS",
  "VITE_KEY_TOKEN_ADDRESS",
  "KEY_AUTO_LIQUIDITY_VAULT_ADDRESS",
  "TREASURY_VAULT_ADDRESS",
  "VITE_TREASURY_VAULT_ADDRESS",
  "LP_RESERVE_RECIPIENT",
  "VITE_LP_RESERVE_ADDRESS",
  "TREASURY_RESERVE_RECIPIENT",
  "VITE_TREASURY_RESERVE_ADDRESS",
  "LIQUIDITY_MANAGER_ADDRESS",
  "KEY_IDENTITY_ADDRESS",
  "VITE_KEY_IDENTITY_ADDRESS",
  "KEY_REGISTRAR_ADDRESS",
  "VITE_KEY_REGISTRAR_ADDRESS",
  "KEY_MARKET_ADDRESS",
  "VITE_KEY_MARKET_ADDRESS",
  "UNISWAP_V4_POOL_ID",
  "VITE_UNISWAP_V4_POOL_ID",
  "UNISWAP_V4_HOOK_ADDRESS",
  "VITE_UNISWAP_V4_HOOK_ADDRESS",
  "UNISWAP_V4_POOL_MANAGER",
  "UNISWAP_V4_INITIALIZE_TX",
  "UNISWAP_V4_FEE",
  "UNISWAP_V4_TICK_SPACING",
  "VITE_BACKEND_URL",
  "CORS_ORIGIN",
  "SPHINCS_VERIFY_MODE",
  "SPHINCS_VERIFY_COMMAND",
];

const updates = {};
for (const key of keys) {
  if (Object.prototype.hasOwnProperty.call(env, key)) updates[key] = String(env[key] || "");
}

const remoteScript = `
const fs = require("fs");
const path = ${JSON.stringify(remotePath)};
const updates = ${JSON.stringify(updates)};
const files = [".env.production", ".env.mainnet"];

function upsertEnv(file) {
  const target = path + "/" + file;
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").split(/\\r?\\n/) : [];
  const seen = new Set();
  const next = current.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return match[1] + "=" + updates[match[1]];
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(key + "=" + value);
  }
  fs.writeFileSync(target, next.filter((line, index, all) => line || index < all.length - 1).join("\\n") + "\\n");
  console.log("updated " + file);
}

for (const file of files) upsertEnv(file);
`;

const result = spawnSync("ssh", [remoteHost, "node -"], {
  input: remoteScript,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
});

if (result.stdout.trim()) console.log(result.stdout.trim());
if (result.stderr.trim()) console.error(result.stderr.trim());
if (result.status !== 0) throw new Error("VPS env sync failed");
