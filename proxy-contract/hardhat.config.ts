import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const baseMainnetRpcUrl = process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

const accounts = deployerPrivateKey ? [deployerPrivateKey] : [];

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: baseSepoliaRpcUrl,
      chainId: 84532,
      accounts,
    },
    baseMainnet: {
      type: "http",
      chainType: "op",
      url: baseMainnetRpcUrl,
      chainId: 8453,
      accounts,
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.BASESCAN_API_KEY ?? "",
    },
  },
};

export default config;
