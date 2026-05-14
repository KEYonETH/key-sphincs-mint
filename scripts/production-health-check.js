import fs from "node:fs";
import dotenv from "dotenv";

const envFile = fs.existsSync(".env.production") ? ".env.production" : fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const env = { ...process.env, ...parsed };

const baseUrl = String(env.VITE_BACKEND_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/+$/, "");
const url = `${baseUrl}/api/status`;

try {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const json = JSON.parse(text);
  if (json.ok !== true) {
    throw new Error(`Unexpected status payload: ${text}`);
  }

  console.log("Production health check passed.");
  console.log("env file:", envFile);
  console.log("status:", url);
  console.log("mode:", json.sphincsVerifyMode || json.mode || "unknown");
} catch (error) {
  console.error("Production health check failed.");
  console.error("status:", url);
  console.error(error?.message || error);
  process.exit(1);
}
