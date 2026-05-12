import "dotenv/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

function envPrivateKey(name) {
  const value = process.env[name] || "";
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

const networks = {
  hardhatMainnet: {
    type: "edr-simulated",
    chainType: "l1",
  },
};

if (process.env.SEPOLIA_RPC_URL && envPrivateKey("SEPOLIA_PRIVATE_KEY")) {
  networks.sepolia = {
    type: "http",
    chainType: "l1",
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [envPrivateKey("SEPOLIA_PRIVATE_KEY")],
  };
}

if (process.env.MAINNET_RPC_URL && envPrivateKey("MAINNET_PRIVATE_KEY")) {
  networks.mainnet = {
    type: "http",
    chainType: "l1",
    url: process.env.MAINNET_RPC_URL,
    accounts: [envPrivateKey("MAINNET_PRIVATE_KEY")],
  };
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "",
    },
    sourcify: {
      enabled: true,
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks,
});
