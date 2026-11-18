// TaxMate: check that Pinata (IPFS) is set up correctly, before making a payment.
// Put this file in backend/scripts/ and run it from the backend folder:
//   node scripts/pinata-check.mjs
// It uploads one tiny test file to Pinata exactly the way the backend uploads receipts,
// then prints the CID it gets back, or Pinata's error message. The JWT is never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const jwt = env.PINATA_JWT || "";
console.log("Settings read from", envPath);
if (!jwt) {
  console.log("PINATA_JWT is empty or missing. That is why receipts get a stub- identifier.");
  console.log("Create an API key in the Pinata dashboard, copy its JWT, and add the line PINATA_JWT=<the JWT> to backend/.env.");
  process.exit(1);
}
const parts = jwt.split(".");
if (!jwt.startsWith("eyJ") || parts.length !== 3) {
  console.log(`PINATA_JWT is set (${jwt.length} characters) but does not look like a JWT.`);
  console.log("A Pinata JWT is a long string starting with eyJ and containing two dots. You may have pasted the");
  console.log("short API Key or the API Secret instead. Copy the JWT shown when the key was created.");
  process.exit(1);
}
console.log(`PINATA_JWT looks like a JWT (${jwt.length} characters).`);

const form = new FormData();
const body = JSON.stringify({ check: "taxmate-pinata-check", at: new Date().toISOString() });
form.append("file", new Blob([body], { type: "application/json" }), "taxmate-pinata-check.json");
form.append("network", "public");
form.append("name", "taxmate-pinata-check");

let res;
try {
  res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
} catch (e) {
  console.log(`Could not reach Pinata: ${e.message}`);
  process.exit(1);
}
const text = await res.text();
let cid;
try { cid = JSON.parse(text)?.data?.cid; } catch { /* not JSON */ }

if (!res.ok || !cid) {
  console.log(`\nPinata refused the upload: HTTP ${res.status}`);
  console.log(`   ${text.slice(0, 300).replace(/\s+/g, " ")}`);
  if (res.status === 401) console.log("   The JWT is wrong, expired or revoked. Create a new key and copy its JWT.");
  if (res.status === 403) console.log("   The key is not allowed to upload files. Create a key with Admin, or with Files: Write.");
  process.exit(1);
}

const gateway = (env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");
console.log(`\nUpload worked. CID: ${cid}`);
console.log(`   View it at ${gateway}/${cid} (it can take a minute to appear).`);
console.log("\nPinata is set up correctly. Restart the backend so it picks up the key, then make a new payment.");
console.log('You can delete the "taxmate-pinata-check" file from your Pinata dashboard.');
