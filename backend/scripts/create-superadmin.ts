import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { users } from "../src/db/schema.js";

// Bootstraps a backend SUPER_ADMIN (the role-based admin the app otherwise has no
// way to create) and maps it to a privileged on-chain address.
//
// Usage (set env, then run `npm run admin:create-superadmin --workspace backend`):
//   SUPERADMIN_EMAIL=...        (required)
//   SUPERADMIN_PASSWORD=...     (required to create; optional to reset on an existing user)
//   SUPERADMIN_WALLET_ADDRESS=  (optional; defaults to the deployer = on-chain SUPER_ADMIN)
//
// Idempotent: if the email already exists, the user is promoted to SUPER_ADMIN.

// Deployer EOA that holds SUPER_ADMIN_ROLE on the Taxmate contract.
const DEFAULT_SUPERADMIN_WALLET = "0xA0fa3A2f6030265545C3eF4B14e9e69466D58F57";

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  const walletAddress = (process.env.SUPERADMIN_WALLET_ADDRESS ?? DEFAULT_SUPERADMIN_WALLET).trim();

  if (!email) {
    throw new Error("SUPERADMIN_EMAIL is required");
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    if (!passwordHash && !existing.passwordHash) {
      throw new Error("Existing user has no password set — provide SUPERADMIN_PASSWORD.");
    }
    const [updated] = await db
      .update(users)
      .set({
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        walletAddress,
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: new Date()
      })
      .where(eq(users.id, existing.id))
      .returning();
    console.log("Promoted existing user to SUPER_ADMIN:");
    console.log({ email: updated.email, role: updated.role, status: updated.status, walletAddress: updated.walletAddress });
  } else {
    if (!passwordHash) {
      throw new Error("SUPERADMIN_PASSWORD is required to create a new super-admin.");
    }
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        walletAddress
      })
      .returning();
    console.log("Created SUPER_ADMIN:");
    console.log({ email: created.email, role: created.role, status: created.status, walletAddress: created.walletAddress });
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error("Failed to create super-admin:", error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
