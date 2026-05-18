import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { ethers } from "ethers";

const envFile = fs.existsSync(".env.mainnet") ? ".env.mainnet" : ".env";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
const stateFile = "deployments/mainnet-clean-auto.json";
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};

function value(name, fallback = "") {
  return String(env[name] || fallback || "").trim();
}

function requireAddress(name, fallback = "") {
  const candidate = value(name, fallback);
  if (!ethers.isAddress(candidate)) throw new Error(`${name} must be a valid address`);
  return ethers.getAddress(candidate);
}

function runVerify(label, contract, address, args) {
  console.log("");
  console.log(`Verifying ${label}: ${address}`);
  fs.mkdirSync("tmp", { recursive: true });
  const argsPath = `tmp/verify-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-clean-mainnet.mjs`;
  fs.writeFileSync(argsPath, `export default ${JSON.stringify(args, null, 2)};\n`);

  const result = spawnSync("npx", [
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
  ], { encoding: "utf8", env, shell: process.platform === "win32" });

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (output) console.log(output);
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

const owner = requireAddress("CONTRACT_OWNER_ADDRESS", state.owner);
const liquidityManager = requireAddress("LIQUIDITY_MANAGER_ADDRESS", state.liquidityManager || owner);
const backendSigner = requireAddress("BACKEND_SIGNER_ADDRESS");
const treasuryReserveRecipient = requireAddress("TREASURY_RESERVE_RECIPIENT", state.treasuryReserveRecipient);
const vault = requireAddress("KEY_AUTO_LIQUIDITY_VAULT_ADDRESS", state.KEYAutoLiquidityVault);
const token = requireAddress("KEY_TOKEN_ADDRESS", state.KEYToken);
const mintGate = requireAddress("MINT_GATE_ADDRESS", state.KEYMintGateV5);
const identity = requireAddress("KEY_IDENTITY_ADDRESS", state.KEYIdentity);
const registrar = requireAddress("KEY_REGISTRAR_ADDRESS", state.KEYSpaceRegistrarV3);
const market = requireAddress("KEY_MARKET_ADDRESS", state.KEYSpaceMarket);
const positionManager = requireAddress("UNISWAP_V4_POSITION_MANAGER", state.positionManager || "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e");
const baseURI = value("KEY_IDENTITY_BASE_URI", "https://api.key-sphincs.xyz/api/keyspace/metadata/");

console.log(`Using ${envFile} for clean auto-liquidity verification.`);
console.log("owner:", owner);
console.log("liquidityManager:", liquidityManager);
console.log("backendSigner:", backendSigner);
console.log("vault:", vault);
console.log("token:", token);
console.log("mintGate:", mintGate);
console.log("identity:", identity);
console.log("registrar:", registrar);
console.log("market:", market);

runVerify("KEYAutoLiquidityVault", "contracts/KEYAutoLiquidityVault.sol:KEYAutoLiquidityVault", vault, [owner, liquidityManager, positionManager]);
runVerify("KEYToken", "contracts/KEYToken.sol:KEYToken", token, [vault, treasuryReserveRecipient]);
runVerify("KEYMintGateV5", "contracts/KEYMintGateV5.sol:KEYMintGateV5", mintGate, [token, vault, backendSigner]);
runVerify("KEYIdentity", "contracts/KEYIdentity.sol:KEYIdentity", identity, [owner, baseURI]);
runVerify("KEYSpaceRegistrarV3", "contracts/KEYSpaceRegistrarV3.sol:KEYSpaceRegistrarV3", registrar, [owner, token, identity, mintGate, []]);
runVerify("KEYSpaceMarket", "contracts/KEYSpaceMarket.sol:KEYSpaceMarket", market, [owner, identity]);

console.log("");
console.log("Clean auto-liquidity verification commands completed.");
