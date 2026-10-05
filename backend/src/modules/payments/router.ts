import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { businessProfiles, individualProfiles, invoices, taxItemsCache, users } from "../../db/schema.js";
import { monnifyClient } from "../../integrations/monnify.js";
import { triggerOnChainRecording } from "../../services/payment-recorder.js";
import { ensureTaxItemOnChain } from "../../services/onchain-tax-item-service.js";
import { generateReceiptPdf } from "../../services/receipt-pdf.js";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../utils/errors.js";
import { env } from "../../config/env.js";

const EXPLORER_TX_URL = `${process.env.EXPLORER_URL ?? "https://sepolia.basescan.org"}/tx/`;

// A real IPFS pin (vs the dev stub CID used when Pinata is unavailable).
function isRealCid(ipfsHash: string | null): ipfsHash is string {
  // "stub-" (dev fallback) and "local-" (Pinata-unavailable content hash) don't resolve on a gateway.
  return Boolean(ipfsHash) && !ipfsHash!.startsWith("stub-") && !ipfsHash!.startsWith("local-");
}

function ipfsGatewayUrl(ipfsHash: string): string {
  return `${env.PINATA_GATEWAY_URL.replace(/\/$/, "")}/${ipfsHash}`;
}

export const paymentsRouter = Router();

const invoiceSchema = z.object({
  onChainItemId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive()
});

// Monnify sends { eventType, eventData: { paymentReference, paymentStatus, ... } }.
// The flat fields are kept for manual/local simulation.
const webhookSchema = z
  .object({
    eventType: z.string().optional(),
    eventData: z
      .object({
        paymentReference: z.string().optional(),
        transactionReference: z.string().optional(),
        paymentStatus: z.string().optional()
      })
      .passthrough()
      .optional(),
    invoiceId: z.string().uuid().optional(),
    paymentReference: z.string().optional(),
    transactionReference: z.string().optional(),
    status: z.string().optional()
  })
  .passthrough();

function amountNumber(value: string): number {
  return Number.parseFloat(value);
}

type Payer = { tin: string; profileType: "INDIVIDUAL" | "BUSINESS"; email: string; customerName: string };

async function getPayer(userId: string): Promise<Payer> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.profileType) {
    throw new ApiError(404, "User profile not found");
  }

  if (user.profileType === "BUSINESS") {
    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, userId)).limit(1);
    if (!profile?.tin) {
      throw new ApiError(400, "Business TIN is not available");
    }
    return { tin: profile.tin, profileType: "BUSINESS", email: user.email, customerName: profile.companyName ?? user.email };
  }

  const [profile] = await db.select().from(individualProfiles).where(eq(individualProfiles.userId, userId)).limit(1);
  if (!profile?.tin) {
    throw new ApiError(400, "Individual TIN is not available");
  }

  const fullName = [profile.firstname, profile.lastname].filter(Boolean).join(" ").trim();
  return { tin: profile.tin, profileType: "INDIVIDUAL", email: user.email, customerName: fullName || user.email };
}

async function serializeInvoice(invoice: typeof invoices.$inferSelect) {
  const [taxItem] = await db
    .select()
    .from(taxItemsCache)
    .where(eq(taxItemsCache.onChainItemId, invoice.onChainItemId))
    .limit(1);

  return {
    id: invoice.id,
    invoiceId: invoice.id,
    taxItemCacheId: invoice.taxItemCacheId,
    onChainItemId: invoice.onChainItemId,
    taxItemName: taxItem?.name ?? `Tax item #${invoice.onChainItemId}`,
    category: taxItem?.category ?? null,
    tin: invoice.tin,
    amount: amountNumber(invoice.amount),
    amountLabel: `₦${amountNumber(invoice.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
    monnifyRef: invoice.monnifyRef,
    monnifyTxRef: invoice.monnifyTxRef,
    status: invoice.status,
    ipfsHash: invoice.ipfsHash,
    // Only expose a gateway URL for a real pin; a stub CID won't resolve.
    ipfsPinned: isRealCid(invoice.ipfsHash),
    receiptUrl: isRealCid(invoice.ipfsHash) ? ipfsGatewayUrl(invoice.ipfsHash) : null,
    receiptDownloadUrl: `/payments/receipt/${invoice.id}/download`,
    txHash: invoice.txHash,
    onChainRecordId: invoice.onChainRecordId,
    expiresAt: invoice.expiresAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString()
  };
}

// Marks a paid invoice as PAID and queues the on-chain recording (which pins the
// receipt and calls recordTaxPayment). Idempotent: the PENDING -> PAID flip is a
// guarded atomic update, so concurrent callers (webhook + active verification)
// only process it once.
async function confirmInvoicePayment(
  invoiceId: string,
  paymentRefValue: string
): Promise<typeof invoices.$inferSelect> {
  const paidAt = new Date();
  const [claimed] = await db
    .update(invoices)
    .set({ status: "PAID", monnifyTxRef: paymentRefValue, paidAt })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "PENDING")))
    .returning();

  if (!claimed) {
    // Already processed by a prior webhook/verify call.
    const [current] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    return current;
  }

  const [user] = await db.select().from(users).where(eq(users.id, claimed.userId)).limit(1);
  if (user?.profileType === "BUSINESS") {
    await db.update(businessProfiles).set({ lastPaymentDate: paidAt }).where(eq(businessProfiles.userId, user.id));
  } else if (user?.profileType === "INDIVIDUAL") {
    await db.update(individualProfiles).set({ lastPaymentDate: paidAt }).where(eq(individualProfiles.userId, user.id));
  }

  // Record on-chain in-process (fire-and-forget, idempotent). Re-driven by the
  // polled /verify endpoint and the admin retry action if it doesn't complete.
  triggerOnChainRecording(claimed.id);

  return claimed;
}

const MONNIFY_PAID_STATUSES = new Set(["PAID", "OVERPAID"]);
const MONNIFY_FAILED_STATUSES = new Set(["FAILED", "CANCELLED", "ABANDONED", "REVERSED", "EXPIRED"]);

paymentsRouter.post("/invoice", requireAuth, async (req, res, next) => {
  try {
    const payload = invoiceSchema.parse(req.body);
    const [taxItem] = await db
      .select()
      .from(taxItemsCache)
      .where(eq(taxItemsCache.onChainItemId, payload.onChainItemId))
      .limit(1);

    if (!taxItem || !taxItem.isActive) {
      throw new ApiError(404, "Active tax item not found");
    }

    const payer = await getPayer(req.authUser!.id);

    // Ensure the tax item exists on-chain before the invoice is created (so the
    // later recordTaxPayment won't revert on a missing item). Returns the id the
    // contract actually holds for this item.
    const onChainItemId = await ensureTaxItemOnChain(taxItem.onChainItemId);

    const monnifyRef = `TM-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const [invoice] = await db
      .insert(invoices)
      .values({
        userId: req.authUser!.id,
        taxItemCacheId: taxItem.id,
        onChainItemId,
        tin: payer.tin,
        amount: payload.amount.toFixed(2),
        monnifyRef,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      })
      .returning();

    const payment = await monnifyClient.initTransaction({
      paymentReference: monnifyRef,
      amount: payload.amount,
      currencyCode: "NGN",
      customerName: payer.customerName,
      customerEmail: payer.email,
      paymentDescription: `Taxmate • ${taxItem.name}`
    });

    res.status(201).json({ item: await serializeInvoice(invoice), payment });
  } catch (error) {
    next(error);
  }
});

paymentsRouter.get("/invoice/:id", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.id))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    res.status(200).json({ item: await serializeInvoice(invoice) });
  } catch (error) {
    next(error);
  }
});

// (Re)initialize a Monnify checkout for an existing, not-yet-paid invoice so the
// user can pay it from the payment history. Issues a fresh payment reference.
paymentsRouter.post("/invoice/:id/checkout", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.id))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }
    if (!["PENDING", "FAILED", "EXPIRED"].includes(invoice.status)) {
      throw new ApiError(409, `Invoice is already ${invoice.status.toLowerCase()}`);
    }

    const payer = await getPayer(req.authUser!.id);
    const [taxItem] = await db
      .select()
      .from(taxItemsCache)
      .where(eq(taxItemsCache.onChainItemId, invoice.onChainItemId))
      .limit(1);

    const monnifyRef = `TM-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const [updated] = await db
      .update(invoices)
      .set({ monnifyRef, status: "PENDING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
      .where(eq(invoices.id, invoice.id))
      .returning();

    const payment = await monnifyClient.initTransaction({
      paymentReference: monnifyRef,
      amount: amountNumber(invoice.amount),
      currencyCode: "NGN",
      customerName: payer.customerName,
      customerEmail: payer.email,
      paymentDescription: `Taxmate • ${taxItem?.name ?? "Tax payment"}`
    });

    res.status(200).json({ item: await serializeInvoice(updated), payment });
  } catch (error) {
    next(error);
  }
});

const monnifyInitSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentReference: z.string().min(1),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  paymentDescription: z.string().optional(),
  currencyCode: z.string().optional(),
  redirectUrl: z.string().url().optional()
});

paymentsRouter.post("/monnify/init", requireAuth, async (req, res, next) => {
  try {
    const result = await monnifyClient.initTransaction(monnifyInitSchema.parse(req.body));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

paymentsRouter.post("/monnify/webhook", async (req, res, next) => {
  try {
    // Verify against the exact raw bytes Monnify signed (HMAC-SHA512, secret key).
    const signature = req.header("monnify-signature") ?? "";
    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    if (!monnifyClient.verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ message: "Invalid signature" });
      return;
    }

    const payload = webhookSchema.parse(req.body);
    const eventData = payload.eventData ?? {};
    const eventType = (payload.eventType ?? "").toUpperCase();
    const paymentReference = eventData.paymentReference ?? eventData.transactionReference ?? payload.paymentReference ?? payload.transactionReference;
    const paymentStatus = (eventData.paymentStatus ?? payload.status ?? "").toUpperCase();

    const succeeded = paymentStatus === "PAID" || paymentStatus === "OVERPAID" || eventType === "SUCCESSFUL_TRANSACTION";
    const failed = paymentStatus.includes("FAIL") || eventType.includes("FAILED") || eventType.includes("REVERSED");

    const [invoice] = payload.invoiceId
      ? await db.select().from(invoices).where(eq(invoices.id, payload.invoiceId)).limit(1)
      : paymentReference
        ? await db.select().from(invoices).where(eq(invoices.monnifyRef, paymentReference)).limit(1)
        : [];

    // Always acknowledge with 200 so Monnify doesn't retry events we can't act on.
    if (!invoice) {
      res.status(200).json({ received: true });
      return;
    }

    if (succeeded) {
      await confirmInvoicePayment(invoice.id, paymentReference ?? invoice.monnifyRef);
    } else if (failed && invoice.status === "PENDING") {
      await db.update(invoices).set({ status: "FAILED" }).where(eq(invoices.id, invoice.id)).returning();
    }

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
});

// Webhook-independent reconciliation: ask Monnify for the real payment status and
// progress the invoice accordingly. Essential for local dev (Monnify can't reach
// localhost) and as a production safety net for missed webhooks.
paymentsRouter.post("/invoice/:id/verify", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.id))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    // Already settled (or being recorded on-chain) — no need to re-query Monnify.
    if (invoice.status !== "PENDING") {
      // Re-drive on-chain recording if the payment is in but not yet recorded.
      if (invoice.status === "PAID" && !invoice.txHash) {
        triggerOnChainRecording(invoice.id);
      }
      res.status(200).json({ item: await serializeInvoice(invoice) });
      return;
    }

    const { paymentStatus } = await monnifyClient.getTransactionStatus(invoice.monnifyRef);
    const normalized = paymentStatus.toUpperCase();

    let updated = invoice;
    if (MONNIFY_PAID_STATUSES.has(normalized)) {
      updated = await confirmInvoicePayment(invoice.id, invoice.monnifyTxRef ?? invoice.monnifyRef);
    } else if (MONNIFY_FAILED_STATUSES.has(normalized)) {
      [updated] = await db.update(invoices).set({ status: "FAILED" }).where(eq(invoices.id, invoice.id)).returning();
    }

    res.status(200).json({ item: await serializeInvoice(updated), paymentStatus: normalized });
  } catch (error) {
    next(error);
  }
});

// Canonical receipt document — always available (built from DB), independent of
// whether the IPFS pin succeeded.
async function buildReceipt(invoice: typeof invoices.$inferSelect) {
  const [taxItem] = await db
    .select()
    .from(taxItemsCache)
    .where(eq(taxItemsCache.onChainItemId, invoice.onChainItemId))
    .limit(1);

  return {
    document: "Taxmate Tax Payment Receipt",
    invoiceId: invoice.id,
    status: invoice.status,
    tin: invoice.tin,
    taxItem: taxItem?.name ?? `Tax item #${invoice.onChainItemId}`,
    category: taxItem?.category ?? null,
    amount: `₦${amountNumber(invoice.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
    paymentReference: invoice.monnifyTxRef ?? invoice.monnifyRef,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null,
    blockchain: {
      network: "Base Sepolia",
      contract: env.TAXMATE_CONTRACT_ADDRESS ?? null,
      txHash: invoice.txHash,
      explorerUrl: invoice.txHash ? `${EXPLORER_TX_URL}${invoice.txHash}` : null
    },
    ipfs: isRealCid(invoice.ipfsHash)
      ? { cid: invoice.ipfsHash, gatewayUrl: ipfsGatewayUrl(invoice.ipfsHash) }
      : { cid: null, gatewayUrl: null, note: "IPFS receipt not pinned (gateway unavailable)" }
  };
}

paymentsRouter.get("/receipt/:invoiceId", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.invoiceId))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    res.status(200).json({
      ...(await buildReceipt(invoice)),
      ipfsPinned: isRealCid(invoice.ipfsHash),
      receiptUrl: isRealCid(invoice.ipfsHash) ? ipfsGatewayUrl(invoice.ipfsHash) : null
    });
  } catch (error) {
    next(error);
  }
});

// Downloadable PDF receipt (works regardless of IPFS pin state).
paymentsRouter.get("/receipt/:invoiceId/download", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.invoiceId))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    const receipt = await buildReceipt(invoice);
    const pdf = await generateReceiptPdf({
      invoiceId: receipt.invoiceId,
      status: receipt.status,
      tin: receipt.tin,
      taxItem: receipt.taxItem,
      category: receipt.category,
      amount: receipt.amount,
      paymentReference: receipt.paymentReference,
      paidAt: receipt.paidAt,
      confirmedAt: receipt.confirmedAt,
      blockchain: receipt.blockchain
    });

    const filename = `taxmate-receipt-${receipt.paymentReference ?? invoice.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(pdf);
  } catch (error) {
    next(error);
  }
});
