import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

const env = { ...process.env };

if (fs.existsSync(".env.mainnet")) {
  const parsed = dotenv.parse(fs.readFileSync(".env.mainnet"));
  Object.assign(env, parsed);
  console.log("Using .env.mainnet for mainnet deployment.");
} else {
  console.log("No .env.mainnet found. Falling back to current shell/.env values.");
}

const hardhatCli = path.resolve("node_modules", "hardhat", "dist", "src", "cli.js");
const result = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--network", "mainnet", "scripts/deploy-mainnet.js"],
  { stdio: "inherit", env }
);

if (result.error) {
  console.error("Failed to start Hardhat mainnet deploy:");
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
