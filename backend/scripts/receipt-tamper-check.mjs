// TaxMate: receipt-tampering check (Table 4.1, "Altered receipt record").
// Put this file in backend/scripts/ and run it from the backend folder:
//   node scripts/receipt-tamper-check.mjs
// Options:  --invoice <invoice id>   test a specific CONFIRMED invoice (default: the most recent one)
//           --tx 0x...               the Base Sepolia transaction hash, if the database does not hold it
//           --pin                    also upload the altered record to Pinata, so Pinata itself computes its CID
//                                    (the upload is named "taxmate-tamper-test-..."; delete it afterwards)
//
// Steps: (1) read the receiptHash stored on-chain for a confirmed payment, (2) download that receipt
// record from IPFS and confirm it reproduces the same content identifier (CID), (3) change the amount
// in a copy of the record and show that its CID no longer matches the on-chain value.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Interface, JsonRpcProvider } from "ethers";

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
const flag = (name) => process.argv.includes(`--${name}`);

// ---------- CID computation (IPFS content identifiers, single-block files) ----------
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
function varint(n) {
  const o = [];
  while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  o.push(n);
  return o;
}
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
function dagPbFile(data) {
  const u = [0x08, 0x02];
  if (data.length) u.push(0x12, ...varint(data.length), ...data);
  u.push(0x18, ...varint(data.length));
  return Buffer.from([0x0a, ...varint(u.length), ...u]);
}
// Compute the CID of `data` in the same format (version and codec) as `example`.
function cidLike(example, data) {
  if (data.length > 262144) return null; // multi-block files are not handled here
  if (example.startsWith("Qm")) return base58(Buffer.concat([Buffer.from([0x12, 0x20]), sha256(dagPbFile(data))]));
  if (example.startsWith("bafk")) return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), sha256(data)]));
  if (example.startsWith("bafy")) return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x70, 0x12, 0x20]), sha256(dagPbFile(data))]));
  return null;
}

// ---------- 1. pick a confirmed payment ----------
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing from backend/.env.");
  process.exit(1);
}
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const chosen = arg("invoice");
const { rows } = chosen
  ? await db.query("SELECT id, status, ipfs_hash, tx_hash, amount FROM invoices WHERE id = $1", [chosen])
  : await db.query(
      "SELECT id, status, ipfs_hash, tx_hash, amount FROM invoices WHERE status = 'CONFIRMED' AND ipfs_hash IS NOT NULL ORDER BY confirmed_at DESC NULLS LAST LIMIT 1"
    );
await db.end();
const inv = rows[0];
if (!inv || inv.status !== "CONFIRMED") {
  console.log(inv ? `Invoice ${inv.id} is ${inv.status}, not CONFIRMED.` : "No CONFIRMED payment found.");
  console.log("Complete a sandbox payment in TaxMate, wait until it shows as confirmed on-chain, then run this again.");
  process.exit(1);
}
console.log(`Invoice          : ${inv.id}  (amount NGN ${inv.amount})`);
console.log(`CID in database  : ${inv.ipfs_hash}`);
if (/^(stub-|local-)/.test(inv.ipfs_hash)) {
  console.log("\nThis payment's receipt was NOT pinned to IPFS: the identifier is a placeholder (stub-/local-),");
  console.log("which the backend uses when PINATA_JWT is missing or Pinata fails. Set a valid PINATA_JWT in");
  console.log("backend/.env, restart the backend, make a new payment, and run this again.");
  process.exit(1);
}

// ---------- 2. read the receiptHash stored on-chain ----------
const txHash = arg("tx") || inv.tx_hash;
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) {
  console.log(`\nThe database holds "${txHash}" instead of a Base transaction hash.`);
  console.log("Find the transaction hash on the payment's PDF receipt or on BaseScan and run again with --tx 0x...");
  process.exit(1);
}
const rpc = env.BASE_RPC_URL || "https://sepolia.base.org";
const provider = new JsonRpcProvider(rpc);
const iface = new Interface([
  "event TaxPaid(uint256 indexed recordId, address indexed payer, string tin, uint256 itemId, uint256 amountPaid, string paymentRef, string receiptHash, uint256 timestamp)"
]);
const receipt = await provider.getTransactionReceipt(txHash);
if (!receipt) {
  console.log(`\nTransaction ${txHash} was not found on ${rpc}.`);
  process.exit(1);
}
let onChain = null;
for (const log of receipt.logs) {
  if (env.TAXMATE_CONTRACT_ADDRESS && log.address.toLowerCase() !== env.TAXMATE_CONTRACT_ADDRESS.toLowerCase()) continue;
  try {
    const ev = iface.parseLog(log);
    if (ev?.name === "TaxPaid") onChain = { recordId: ev.args.recordId.toString(), receiptHash: ev.args.receiptHash, contract: log.address };
  } catch { /* not a TaxPaid log */ }
}
if (!onChain) {
  console.log(`\nNo TaxPaid event from the TaxMate contract was found in transaction ${txHash}.`);
  process.exit(1);
}
console.log(`Transaction      : ${txHash}`);
console.log(`                   https://sepolia.basescan.org/tx/${txHash}`);
console.log(`On-chain record  : #${onChain.recordId} in contract ${onChain.contract}`);
console.log(`receiptHash      : ${onChain.receiptHash}  (on-chain)`);
if (onChain.receiptHash !== inv.ipfs_hash) {
  console.log("Note: the on-chain receiptHash differs from the CID in the database; the on-chain value is used below.");
}
const cid = onChain.receiptHash;

// ---------- 3. download the anchored receipt record and check it reproduces the CID ----------
const gateways = [env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs", "https://ipfs.io/ipfs", "https://dweb.link/ipfs"];
let original = null;
for (const g of gateways) {
  try {
    const r = await fetch(`${g.replace(/\/+$/, "")}/${cid}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log(`   ${g}: HTTP ${r.status}`); continue; }
    const bytes = Buffer.from(await r.arrayBuffer());
    if (cidLike(cid, bytes) === cid) { original = bytes; console.log(`Downloaded from  : ${g}`); break; }
    console.log(`   ${g}: content did not reproduce the CID (gateway error page?), trying the next gateway`);
  } catch (e) {
    console.log(`   ${g}: ${e.message}`);
  }
}
if (!original) {
  if (!cidLike(cid, Buffer.from("x"))) console.log(`\nThis CID format (${cid.slice(0, 6)}...) is not handled by this script.`);
  console.log("\nCould not download the receipt record and reproduce its CID. Try again later, or run with --pin.");
  process.exit(1);
}
console.log(`\n1. Unaltered record downloaded from IPFS:\n   ${original.toString("utf8")}`);
console.log(`   Recomputed CID : ${cidLike(cid, original)}`);
console.log(`   Matches the on-chain receiptHash: YES`);

// ---------- 4. alter the amount in a copy and recompute ----------
const record = JSON.parse(original.toString("utf8"));
const sameBytes = JSON.stringify(record) === original.toString("utf8");
if (!("amount" in record)) {
  console.log("The record has no 'amount' field; cannot run the alteration step.");
  process.exit(1);
}
const oldAmount = record.amount;
record.amount = (Number(oldAmount) + 1000).toFixed(2);
const altered = Buffer.from(JSON.stringify(record));
const alteredCid = cidLike(cid, altered);
console.log(`\n2. Altered copy (amount changed from ${oldAmount} to ${record.amount}${sameBytes ? "; nothing else changed" : ""}):`);
console.log(`   ${altered.toString("utf8")}`);
console.log(`   Recomputed CID : ${alteredCid}`);
const detected = alteredCid !== cid;
console.log(`   Matches the on-chain receiptHash: ${detected ? "NO - the alteration is detected" : "YES - NOT detected"}`);

// ---------- 5. optional: let Pinata compute the altered record's CID ----------
if (flag("pin")) {
  if (!env.PINATA_JWT) {
    console.log("\n--pin needs PINATA_JWT in backend/.env.");
  } else {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(altered)], { type: "application/json" }), `${inv.id}.json`);
    form.append("network", "public");
    form.append("name", `taxmate-tamper-test-${inv.id}`);
    const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${env.PINATA_JWT}` }, body: form });
    const j = await r.json().catch(() => ({}));
    const pinned = j?.data?.cid;
    console.log(`\n3. Altered copy uploaded to Pinata: ${pinned ? `CID ${pinned}` : `failed (HTTP ${r.status})`}`);
    if (pinned) {
      console.log(`   Matches the on-chain receiptHash: ${pinned === cid ? "YES" : "NO"}; matches the CID computed above: ${pinned === alteredCid ? "YES" : "NO"}`);
      console.log(`   Delete "taxmate-tamper-test-${inv.id}" from your Pinata dashboard afterwards.`);
    }
  }
}

console.log(
  detected
    ? `\nResult for Table 4.1: Passed - the unaltered record reproduced the on-chain CID (${cid}); changing the amount from ${oldAmount} to ${record.amount} produced a different CID (${alteredCid}), so the alteration is detectable.`
    : "\nResult: NOT passed - see the lines above. Copy everything above and send it back."
);
