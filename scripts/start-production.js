import fs from "node:fs";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

const env = { ...process.env };

if (fs.existsSync(".env.production")) {
  Object.assign(env, dotenv.parse(fs.readFileSync(".env.production")));
  console.log("Using .env.production");
} else {
  console.log("No .env.production found. Using current shell/.env values.");
}

env.NODE_ENV = env.NODE_ENV || "production";

const child = spawn(process.execPath, ["backend/server.js"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 1));
