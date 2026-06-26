import { Worker, type ConnectionOptions } from "bullmq";
import { eq } from "drizzle-orm";
import { circleExecutionMap } from "../blockchain/taxmateContract.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/client.js";
import { invoices, users } from "../db/schema.js";
import { circleClient } from "../integrations/circle.js";
import { pinataClient } from "../integrations/pinata.js";
import { sleep } from "../utils/sleep.js";

const connection: ConnectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

// Circle runs in mock mode unless both of these are set (mirrors CircleClient).
const circleRealMode = Boolean(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET);

export interface OnChainPaymentJob {
  invoiceId: string;
}

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
// is a no-op, so BullMQ retries are safe.
export async function processOnChainPayment(invoiceId: string): Promise<void> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }
  if (invoice.status === "CONFIRMED" && invoice.txHash) {
    logger.info({ invoiceId }, "Invoice already recorded on-chain; skipping");
    return;
  }

  // Pin the receipt here (not at payment time) so the whole post-payment pipeline
  // is a single retryable unit — a transient Pinata failure no longer strands the
  // invoice as PAID-with-no-receipt.
  let receiptHash = invoice.ipfsHash;
  if (!receiptHash) {
    const receipt = await pinataClient.pinReceipt(
      Buffer.from(
        JSON.stringify({
          invoiceId: invoice.id,
          tin: invoice.tin,
          onChainItemId: invoice.onChainItemId,
          amount: invoice.amount,
          paymentRef: invoice.monnifyTxRef ?? invoice.monnifyRef,
          paidAt: invoice.paidAt?.toISOString() ?? null
        })
      ),
      invoice.id
    );
    receiptHash = receipt.cid;
    await db.update(invoices).set({ ipfsHash: receiptHash }).where(eq(invoices.id, invoice.id));
  }

  const [user] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);
  if (!user?.walletAddress) {
    throw new Error(`User ${invoice.userId} has no wallet address`);
  }
  if (!user.onChainRegistered) {
    throw new Error(`User ${invoice.userId} is not registered on-chain`);
  }

  // recordTaxPayment is `onlySubAdmin`, so it must be sent from the admin wallet
  // (which must hold SUB_ADMIN_ROLE on the contract), not the taxpayer's wallet.
  if (circleRealMode && !env.CIRCLE_ADMIN_WALLET_ID) {
    throw new Error("CIRCLE_ADMIN_WALLET_ID is required to record tax payments (recordTaxPayment is admin-only)");
  }
  const adminWalletId = env.CIRCLE_ADMIN_WALLET_ID ?? user.circleWalletId ?? "mock-admin-wallet";

  // `amount` is stored as naira with 2 decimals (numeric). The contract takes a
  // uint256, so we record kobo (integer minor units) to preserve precision.
  const amountKobo = Math.round(Number.parseFloat(invoice.amount) * 100);
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    throw new Error(`Invoice ${invoiceId} has an invalid amount: ${invoice.amount}`);
  }

  const paymentRef = invoice.monnifyTxRef ?? invoice.monnifyRef;

  const execution = await circleClient.executeContract({
    walletId: adminWalletId,
    abiFunctionSignature: circleExecutionMap.paymentRecord, // recordTaxPayment(address,string,uint256,uint256,string,string)
    abiParameters: [
      user.walletAddress,
      invoice.tin,
      String(invoice.onChainItemId),
      String(amountKobo),
      paymentRef,
      receiptHash
    ]
  });

  const txHash = await pollTxHash(execution.transactionId);

  await db
    .update(invoices)
    .set({
      status: "CONFIRMED",
      confirmedAt: new Date(),
      txHash: txHash || execution.transactionId
    })
    .where(eq(invoices.id, invoice.id));

  logger.info({ invoiceId, txHash }, "Tax payment recorded on-chain");
}

let worker: Worker<OnChainPaymentJob> | null = null;

export function startOnChainPaymentWorker(): Worker<OnChainPaymentJob> {
  worker = new Worker<OnChainPaymentJob>(
    "on-chain-payment",
    async (job) => {
      await processOnChainPayment(job.data.invoiceId);
    },
    { connection, concurrency: 3 }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, invoiceId: job?.data?.invoiceId, attemptsMade: job?.attemptsMade, err: err.message },
      "on-chain-payment job failed"
    );
  });
  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, invoiceId: job.data.invoiceId }, "on-chain-payment job completed");
  });

  return worker;
}

export async function stopOnChainPaymentWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
