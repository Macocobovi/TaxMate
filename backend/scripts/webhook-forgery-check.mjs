// TaxMate: forged-webhook check (Table 4.1, "Forged payment confirmation").
// Put this file in backend/scripts/ and run it from the backend folder, with the backend running:
//   node scripts/webhook-forgery-check.mjs
// Options:  --invoice <invoice id>   test a specific PENDING invoice (default: your most recent one)
//           --api http://localhost:4000/api   if your backend runs elsewhere
//
// It sends fake "payment successful" notifications to the Monnify webhook endpoint for an
// unpaid invoice and checks that the backend rejects them and the invoice stays PENDING.
// Nothing is paid and no secrets are printed.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// ---------- settings ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = [path.join(here, "..", ".env"), path.join(process.cwd(), ".env")].find((p) => fs.existsSync(p));
if (!envPath) {
  console.error("Could not find backend/.env. Run this from the backend folder.");
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const API = (arg("api") || `http://localhost:${env.PORT || 4000}${env.API_PREFIX || "/api"}`).replace(/\/+$/, "");
const WEBHOOK = `${API}/payments/monnify/webhook`;
const SECRET = env.MONNIFY_SECRET_KEY || "";
const sign = (body, key) => crypto.createHmac("sha512", key).update(body).digest("hex");

if (!SECRET) {
  console.log("MONNIFY_SECRET_KEY is empty in backend/.env. In that case the backend accepts every webhook");
  console.log("without checking its signature (development mode), so this test cannot pass. Set the key and retry.");
  process.exit(1);
}
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing from backend/.env.");
  process.exit(1);
}

// ---------- backend reachable? ----------
try {
  const r = await fetch(`${API}/health`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.error(`The backend is not answering at ${API} (${e.message}). Start it, then run this again.`);
  process.exit(1);
}

// ---------- pick an unpaid invoice ----------
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const status = async (id) => (await db.query("SELECT status FROM invoices WHERE id = $1", [id])).rows[0]?.status;

const chosen = arg("invoice");
const { rows } = chosen
  ? await db.query("SELECT id, monnify_ref, amount, status FROM invoices WHERE id = $1", [chosen])
  : await db.query("SELECT id, monnify_ref, amount, status FROM invoices WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 1");
const inv = rows[0];
if (!inv || inv.status !== "PENDING") {
  console.log(inv ? `Invoice ${inv.id} is ${inv.status}, not PENDING.` : "No PENDING invoice found.");
  console.log("In TaxMate, start a payment for any tax item, close the Monnify page without paying, then run this again.");
  await db.end();
  process.exit(1);
}

console.log(`Webhook endpoint : ${WEBHOOK}`);
console.log(`Target invoice   : ${inv.id}`);
console.log(`Payment reference: ${inv.monnify_ref}   amount: NGN ${inv.amount}   status: ${inv.status}\n`);

const forgedPaid = (ref) =>
  JSON.stringify({
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      paymentReference: ref,
      transactionReference: `MNFY|FORGED|${Date.now()}`,
      paymentStatus: "PAID",
      amountPaid: Number(inv.amount),
      totalPayable: Number(inv.amount),
      paidOn: new Date().toISOString(),
      paymentMethod: "CARD",
      currency: "NGN"
    }
  });

async function send(body, signature) {
  const headers = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["monnify-signature"] = signature;
  const r = await fetch(WEBHOOK, { method: "POST", headers, body });
  return r.status;
}

// ---------- 0. control: a correctly signed notification about a payment that does not exist ----------
const control = forgedPaid(`TM-CHECK-NONEXISTENT-${Date.now()}`);
const c0 = await send(control, sign(control, SECRET));
console.log(`0. Control - correctly signed notification for a non-existent payment`);
console.log(`   HTTP ${c0} (expected 200: the endpoint is reachable and the backend uses the same secret key)`);
if (c0 !== 200) {
  console.log("   The control did not return 200. If you changed backend/.env, restart the backend and run this again.");
}

// ---------- forged notifications for the real unpaid invoice ----------
const body = forgedPaid(inv.monnify_ref);
const genuineLooking = body.replace('"paymentStatus":"PAID"', '"paymentStatus":"PENDING"');
const tests = [
  ["1. Forged 'paid' notification with no signature", body, undefined],
  ["2. Forged 'paid' notification signed with a wrong key", body, sign(body, "not-the-monnify-secret-key")],
  ["3. Correctly signed notification whose body was then altered (PENDING changed to PAID)", body, sign(genuineLooking, SECRET)]
];

let allPassed = c0 === 200;
for (const [label, b, sig] of tests) {
  const code = await send(b, sig);
  const after = await status(inv.id);
  const ok = code === 401 && after === "PENDING";
  allPassed &&= ok;
  console.log(`${label}\n   HTTP ${code}; invoice status afterwards: ${after}   -> ${ok ? "PASSED" : "FAILED"}`);
}
await db.end();

console.log(
  allPassed
    ? "\nResult for Table 4.1: Passed - all three forged confirmations were rejected with HTTP 401 and the invoice remained PENDING."
    : "\nResult: NOT passed - see the lines above. Copy everything above and send it back."
);
