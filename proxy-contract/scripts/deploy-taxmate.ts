import "dotenv/config";
import { network } from "hardhat";

const connection = await network.connect();
const { ethers } = connection;

const signers = await ethers.getSigners();
if (signers.length === 0) {
  throw new Error(
    "No deployer signer available. Set DEPLOYER_PRIVATE_KEY in proxy-contract/.env (0x-prefixed) and ensure BASE_SEPOLIA_RPC_URL is valid."
  );
}

const [deployer] = signers;
const superAdminFromEnv = process.env.SUPER_ADMIN_ADDRESS;
const superAdmin = superAdminFromEnv && superAdminFromEnv.trim() ? superAdminFromEnv : deployer.address;

async function getPendingNonce(): Promise<number> {
  return await ethers.provider.getTransactionCount(deployer.address, "pending");
}

function isNonceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("nonce too low") || message.includes("already known") || message.includes("replacement transaction underpriced");
}

console.log("----------------------------------------");
console.log("Taxmate Deployment");
console.log("Network:", connection.networkName);
console.log("Deployer:", deployer.address);
console.log("Super admin:", superAdmin);
console.log("----------------------------------------");

const deployNonce = await getPendingNonce();
const taxmate = await ethers.deployContract("Taxmate", [], { nonce: deployNonce });
await taxmate.waitForDeployment();

const contractAddress = await taxmate.getAddress();
console.log("Implementation deployed at:", contractAddress);

let initNonce = await getPendingNonce();

try {
  const initTx = await taxmate.initialize(superAdmin, { nonce: initNonce });
  console.log("Initialize tx:", initTx.hash);
  await initTx.wait();
} catch (error) {
  if (!isNonceError(error)) {
    throw error;
  }

  initNonce = await getPendingNonce();
  console.log("Retrying initialize with refreshed nonce:", initNonce);
  const retryTx = await taxmate.initialize(superAdmin, { nonce: initNonce });
  console.log("Initialize retry tx:", retryTx.hash);
  await retryTx.wait();
}

console.log("Deployment complete.");
console.log("Taxmate address:", contractAddress);
console.log("Super admin configured:", superAdmin);
console.log("----------------------------------------");
console.log("Verify command (optional):");
console.log(`npx hardhat verify --network ${connection.networkName} ${contractAddress}`);
