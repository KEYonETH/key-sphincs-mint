import fs from "node:fs";

const envFile = ".env.mainnet";
const stateFile = "deployments/mainnet.json";

if (!fs.existsSync(envFile)) throw new Error(".env.mainnet is required");
if (!fs.existsSync(stateFile)) throw new Error("deployments/mainnet.json is required");

const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const updates = {
  CHAIN_ID: "1",
  VITE_CHAIN_ID: "1",
  MINT_GATE_ADDRESS: state.KEYMintGate,
  VITE_MINT_GATE_ADDRESS: state.KEYMintGate,
  VITE_KEY_TOKEN_ADDRESS: state.KEYToken,
  VITE_TREASURY_VAULT_ADDRESS: state.KEYTreasuryVault,
  VITE_LP_RESERVE_ADDRESS: process.env.LP_RESERVE_RECIPIENT,
  SPHINCS_VERIFY_MODE: "command",
};

let content = fs.readFileSync(envFile, "utf8");

for (const [key, value] of Object.entries(updates)) {
  if (!value) continue;
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content += `${content.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
}

fs.writeFileSync(envFile, content);

console.log("Synced mainnet deployment addresses into .env.mainnet");
console.log("KEYTreasuryVault:", state.KEYTreasuryVault);
console.log("KEYToken:", state.KEYToken);
console.log("KEYMintGate:", state.KEYMintGate);
