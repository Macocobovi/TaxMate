
import "dotenv/config";
import { eq, desc } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import {
  users,
  individualProfiles,
  businessProfiles,
} from "../src/db/schema.js";

async function listTaxpayers() {
  try {
    const records = await db
      .select({
        userId: users.id,
        email: users.email,
        profileType: users.profileType,
        accountStatus: users.status,
        registeredAt: users.createdAt,

        firstname: individualProfiles.firstname,
        lastname: individualProfiles.lastname,
        middlename: individualProfiles.middlename,

        companyName: businessProfiles.companyName,
        rcNumber: businessProfiles.rcNumber,
      })
      .from(users)
      .leftJoin(
        individualProfiles,
        eq(users.id, individualProfiles.userId)
      )
      .leftJoin(
        businessProfiles,
        eq(users.id, businessProfiles.userId)
      )
      .where(eq(users.role, "USER"))
      .orderBy(desc(users.createdAt));

    const taxpayers = records.map((taxpayer) => ({
      "Taxpayer Name":
        taxpayer.profileType === "INDIVIDUAL"
          ? [
              taxpayer.firstname,
              taxpayer.middlename,
              taxpayer.lastname,
            ]
              .filter(Boolean)
              .join(" ") || "Name not available"
          : taxpayer.companyName || "Company name not available",

      Email: taxpayer.email,
      "Account Type": taxpayer.profileType || "Not specified",
      Status: taxpayer.accountStatus,
       "RC Number":
        taxpayer.profileType === "BUSINESS"
          ? taxpayer.rcNumber || "Not available"
          : "N/A",
      "Registration Date":
        taxpayer.registeredAt.toLocaleDateString(),
      "User ID": taxpayer.userId,
    }));

    console.log("\n======================================");
    console.log("       TAXMATE TAXPAYER REGISTER");
    console.log("======================================");
    console.log(`Total taxpayers: ${taxpayers.length}\n`);

    console.table(taxpayers);
  } catch (error) {
    console.error("Failed to retrieve taxpayers:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

listTaxpayers();
