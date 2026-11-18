// TaxMate: Monnify block diagnostic.
// Put this file in backend/scripts/ and run it from the backend folder:
//   node scripts/monnify-check.mjs
// Optional: add your real account details to test them too:
//   node scripts/monnify-check.mjs --name "Your Name" --email you@example.com
//
// It reads backend/.env, logs in to Monnify, then tries to start several small
// test payments that differ in one detail each, to find what Monnify's firewall
// (Cloudflare) objects to. Secrets are never printed. Each accepted attempt only
// creates an unpaid checkout that Monnify expires on its own; no money moves.

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

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const BASE = (env.MONNIFY_BASE_URL || "https://api.monnify.com").replace(/\/+$/, "");
const KEY = env.MONNIFY_API_KEY || "";
const SECRET = env.MONNIFY_SECRET_KEY || "";
const CONTRACT = env.MONNIFY_CONTRACT_CODE || "";
const APP_URL = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TaxMate/1.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describe(status, text) {
  if (/cloudflare/i.test(text) && /blocked/i.test(text)) {
    const ray = (text.match(/Ray ID:\s*<strong[^>]*>([^<]+)</i) || [])[1] || "?";
    return `BLOCKED by Monnify's firewall (Cloudflare Ray ID ${ray})`;
  }
  try {
    const j = JSON.parse(text);
    const msg = j.responseMessage || j.message || j.error || "";
    return j.requestSuccessful ? `accepted (${msg || "success"})` : `refused by Monnify: ${msg || text.slice(0, 200)}`;
  } catch {
    return `unexpected reply: ${text.slice(0, 200).replace(/\s+/g, " ")}`;
  }
}

console.log("Settings read from", envPath);
console.log("  MONNIFY_BASE_URL     ", BASE, BASE.includes("sandbox") ? "(sandbox)" : "(LIVE address)");
console.log("  MONNIFY_API_KEY      ", KEY ? `${KEY.slice(0, 8)}... (${KEY.startsWith("MK_TEST_") ? "test key" : "not a test key"})` : "MISSING");
console.log("  MONNIFY_SECRET_KEY   ", SECRET ? "set" : "MISSING");
console.log("  MONNIFY_CONTRACT_CODE", CONTRACT ? `set (${CONTRACT.length} characters)` : "MISSING");
console.log("  NEXT_PUBLIC_APP_URL  ", APP_URL);
if (!KEY || !SECRET || !CONTRACT) process.exit(1);
if (KEY.startsWith("MK_TEST_") && !BASE.includes("sandbox")) {
  console.log("\n  Warning: test keys are being sent to the live address. Use https://sandbox.monnify.com");
}

// 1. Log in (same request the backend makes)
console.log("\n1. Logging in to Monnify...");
let token;
try {
  const basic = Buffer.from(`${KEY}:${SECRET}`).toString("base64");
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  const t = await r.text();
  console.log(`   HTTP ${r.status}: ${describe(r.status, t)}`);
  token = JSON.parse(t)?.responseBody?.accessToken;
} catch (e) {
  console.log("   Could not reach Monnify:", e.message);
}
if (!token) {
  console.log("   Login failed, so the payment tests were skipped.");
  process.exit(1);
}

// 2. Start test payments, changing one detail at a time
const sample = {
  amount: 100,
  customerName: "Test Customer",
  customerEmail: "test.customer@example.com",
  paymentDescription: "Trial transaction",
  currencyCode: "NGN",
  contractCode: CONTRACT,
  redirectUrl: "https://example.com/payment/confirm",
  paymentMethods: ["CARD", "ACCOUNT_TRANSFER"]
};

const tests = [
  ["A. Monnify's own documented example", {}, false],
  ["B. A + TaxMate's localhost return address", { redirectUrl: `${APP_URL}/dashboard/payments` }, false],
  ["C. A + TaxMate's description with the bullet (•)", { paymentDescription: "Taxmate • Tax payment" }, false],
  ["D. Exactly what TaxMate sends (B + C)", { redirectUrl: `${APP_URL}/dashboard/payments`, paymentDescription: "Taxmate • Tax payment" }, false],
  ["E. D with a browser-style User-Agent", { redirectUrl: `${APP_URL}/dashboard/payments`, paymentDescription: "Taxmate • Tax payment" }, true]
];
if (arg("name") || arg("email")) {
  tests.push(["F. A with your real name and email", { customerName: arg("name") || sample.customerName, customerEmail: arg("email") || sample.customerEmail }, false]);
}

console.log("\n2. Starting test payments of NGN 100:");
for (const [label, change, browserUa] of tests) {
  const body = { ...sample, ...change, paymentReference: `TM-CHECK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (browserUa) headers["User-Agent"] = BROWSER_UA;
  try {
    const r = await fetch(`${BASE}/api/v1/merchant/transactions/init-transaction`, { method: "POST", headers, body: JSON.stringify(body) });
    console.log(`   ${label}\n      HTTP ${r.status}: ${describe(r.status, await r.text())}`);
  } catch (e) {
    console.log(`   ${label}\n      Could not reach Monnify: ${e.message}`);
  }
  await sleep(1500);
}

console.log("\nCopy everything above and send it back.");
