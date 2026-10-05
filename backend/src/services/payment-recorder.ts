import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { circleExecutionMap } from "../blockchain/taxmateContract.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/client.js";
import { invoices, users } from "../db/schema.js";
import { circleClient } from "../integrations/circle.js";
import { pinataClient } from "../integrations/pinata.js";
import { sleep } from "../utils/sleep.js";

// Circle runs in mock mode unless both of these are set (mirrors CircleClient).
const circleRealMode = Boolean(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET);

// Invoices currently being recorded, so concurrent triggers (webhook + polling
// verify + admin retry) never submit the on-chain tx twice.
const inFlight = new Set<string>();

async function pollTxHash(transactionId: string): Promise<string> {
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tx = await circleClient.getTransaction(transactionId);
    const state = tx.state.toUpperCase();

    if (state === "CONFIRMED" || state === "COMPLETE") {
      return tx.txHash ?? "";
    }
    if (state === "FAILED" || state === "REJECTED" || state === "CANCELLED" || state === "DENIED") {
      const detail = [tx.errorReason, tx.errorDetails].filter(Boolean).join(": ");
      throw new Error(`Circle transaction ${transactionId} ended in state ${state}${detail ? ` (${detail})` : ""}`);
    }

    await sleep(2000);
  }
  throw new Error(`Circle transaction ${transactionId} timed out`);
}

// Records a confirmed off-chain payment onto the Taxmate contract via the admin
// (sub-admin) Circle wallet. Idempotent: a re-run on an already-recorded invoice
// is a no-op.
export async function recordTaxPaymentOnChain(invoiceId: string): Promise<void> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }
  if (invoice.status === "CONFIRMED" && invoice.txHash) {
    return;
  }

  // Pin the receipt here (not at payment time) so the whole post-payment step is a
  // single retryable unit. If Pinata is unavailable, fall back to a deterministic
  // content hash instead of stranding the payment — the on-chain record still gets a
  // non-empty receipt reference, and the PDF receipt is generated server-side from the
  // DB (not from IPFS), so downloads keep working. Set a valid PINATA_JWT for real
  // IPFS-resolvable receipts.
  let receiptHash = invoice.ipfsHash;
  if (!receiptHash) {
    const payload = Buffer.from(
      JSON.stringify({
        invoiceId: invoice.id,
        tin: invoice.tin,
        onChainItemId: invoice.onChainItemId,
        amount: invoice.amount,
        paymentRef: invoice.monnifyTxRef ?? invoice.monnifyRef,
        paidAt: invoice.paidAt?.toISOString() ?? null
      })
    );
    try {
      const receipt = await pinataClient.pinReceipt(payload, invoice.id);
      receiptHash = receipt.cid;
    } catch (error) {
      receiptHash = `local-${createHash("sha256").update(payload).digest("hex").slice(0, 46)}`;
      logger.warn(
        { invoiceId: invoice.id, err: error instanceof Error ? error.message : String(error) },
        "Pinata unavailable; recording on-chain with a local receipt hash"
      );
    }
    await db.update(invoices).set({ ipfsHash: receiptHash }).where(eq(invoices.id, invoice.id));
  }

  const [user] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);
  if (!user?.walletAddress) {
    throw new Error(`User ${invoice.userId} has no wallet address`);
  }
  if (!user.onChainRegistered) {
    throw new Error(`User ${invoice.userId} is not registered on-chain`);
  }

  // recordTaxPayment is `onlySubAdmin` — sent from the admin wallet (must hold
  // SUB_ADMIN_ROLE on the contract), not the taxpayer's wallet.
  if (circleRealMode && !env.CIRCLE_ADMIN_WALLET_ID) {
    throw new Error("CIRCLE_ADMIN_WALLET_ID is required to record tax payments (recordTaxPayment is admin-only)");
  }
  const adminWalletId = env.CIRCLE_ADMIN_WALLET_ID ?? user.circleWalletId ?? "mock-admin-wallet";

  // `amount` is naira with 2 decimals; the contract takes a uint256, so record kobo.
  const amountKobo = Math.round(Number.parseFloat(invoice.amount) * 100);
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    throw new Error(`Invoice ${invoiceId} has an invalid amount: ${invoice.amount}`);
  }

  const paymentRef = invoice.monnifyTxRef ?? invoice.monnifyRef;

  const execution = await circleClient.executeContract({
    walletId: adminWalletId,
    abiFunctionSignature: circleExecutionMap.paymentRecord, // recordTaxPayment(address,string,uint256,uint256,string,string)
    abiParameters: [user.walletAddress, invoice.tin, String(invoice.onChainItemId), String(amountKobo), paymentRef, receiptHash]
  });

  const txHash = await pollTxHash(execution.transactionId);

  await db
    .update(invoices)
    .set({ status: "CONFIRMED", confirmedAt: new Date(), txHash: txHash || execution.transactionId })
    .where(eq(invoices.id, invoice.id));

  logger.info({ invoiceId, txHash }, "Tax payment recorded on-chain");
}

// Fire-and-forget, idempotent trigger. Safe to call from the webhook, the polled
// /verify endpoint, and the admin retry action — only one run per invoice at a time.
export function triggerOnChainRecording(invoiceId: string): void {
  if (inFlight.has(invoiceId)) {
    return;
  }
  inFlight.add(invoiceId);
  void recordTaxPaymentOnChain(invoiceId)
    .catch((error) => {
      logger.error({ invoiceId, err: error instanceof Error ? error.message : String(error) }, "on-chain recording failed");
    })
    .finally(() => {
      inFlight.delete(invoiceId);
    });
}
