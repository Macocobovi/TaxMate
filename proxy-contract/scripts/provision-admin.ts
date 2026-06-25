import "dotenv/config";
import { network } from "hardhat";

// Grants SUB_ADMIN_ROLE on the deployed Taxmate contract so the address can call
// admin-gated functions (recordTaxPayment, createTaxItem, updateTaxItem).
//
// Usage:
//   npx hardhat run scripts/provision-admin.ts --network baseSepolia
// Override defaults via env:
//   TAXMATE_CONTRACT_ADDRESS  (deployed proxy/contract address)
//   SUBADMIN_ADDRESS          (address to grant SUB_ADMIN_ROLE to)

const CONTRACT_ADDRESS = process.env.TAXMATE_CONTRACT_ADDRESS ?? "0x52D3c0E7AB127081FE8728Caf58c10Ed4a598d27";
const SUBADMIN_ADDRESS = process.env.SUBADMIN_ADDRESS ?? "0xfa08bbdf8def4d3b19f8b91d0af30aedba32adc1";

const connection = await network.connect();
const { ethers } = connection;

const signers = await ethers.getSigners();
if (signers.length === 0) {
  throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY in proxy-contract/.env and a valid BASE_SEPOLIA_RPC_URL.");
}
const [caller] = signers;

const taxmate = await ethers.getContractAt("Taxmate", CONTRACT_ADDRESS);
const SUPER_ADMIN_ROLE: string = await taxmate.SUPER_ADMIN_ROLE();
const SUB_ADMIN_ROLE: string = await taxmate.SUB_ADMIN_ROLE();

console.log("----------------------------------------");
console.log("Taxmate Admin Provisioning");
console.log("Network:", connection.networkName);
console.log("Contract:", CONTRACT_ADDRESS);
console.log("Caller (must be SUPER_ADMIN):", caller.address);
console.log("Grant SUB_ADMIN_ROLE to:", SUBADMIN_ADDRESS);
console.log("----------------------------------------");

if (!(await taxmate.hasRole(SUPER_ADMIN_ROLE, caller.address))) {
  throw new Error(
    `Caller ${caller.address} does not hold SUPER_ADMIN_ROLE, so it cannot grant sub-admin. Run this with the contract's super-admin key (SUPER_ADMIN_ADDRESS at deploy time).`
  );
}

if (await taxmate.hasRole(SUB_ADMIN_ROLE, SUBADMIN_ADDRESS)) {
  console.log(`${SUBADMIN_ADDRESS} already has SUB_ADMIN_ROLE. Nothing to do.`);
} else {
  const tx = await taxmate.addAdmin(SUBADMIN_ADDRESS, SUB_ADMIN_ROLE);
  console.log("addAdmin tx:", tx.hash);
  await tx.wait();
  console.log("Transaction confirmed.");
}

// Re-poll: a read immediately after the tx can hit a lagging RPC node and
// return stale (false) state even though the grant succeeded.
let granted = false;
for (let attempt = 0; attempt < 5; attempt += 1) {
  granted = await taxmate.hasRole(SUB_ADMIN_ROLE, SUBADMIN_ADDRESS);
  if (granted) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log("----------------------------------------");
console.log(`hasRole(SUB_ADMIN_ROLE, ${SUBADMIN_ADDRESS}):`, granted);
console.log("----------------------------------------");
