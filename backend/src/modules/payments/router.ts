import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { businessProfiles, individualProfiles, invoices, taxItemsCache, users } from "../../db/schema.js";
import { monnifyClient } from "../../integrations/monnify.js";
import { pinataClient } from "../../integrations/pinata.js";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../utils/errors.js";

export const paymentsRouter = Router();

const invoiceSchema = z.object({
  onChainItemId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive()
});

const webhookSchema = z
  .object({
    invoiceId: z.string().uuid().optional(),
    paymentReference: z.string().optional(),
    transactionReference: z.string().optional(),
    status: z.string().optional()
  })
  .passthrough();

function amountNumber(value: string): number {
  return Number.parseFloat(value);
}

function mockTxHash(seed: string): string {
  return `0x${createHash("sha256").update(seed).digest("hex").slice(0, 64)}`;
}

async function getUserTin(userId: string): Promise<{ tin: string; profileType: "INDIVIDUAL" | "BUSINESS" }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.profileType) {
    throw new ApiError(404, "User profile not found");
  }

  if (user.profileType === "BUSINESS") {
    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, userId)).limit(1);
    if (!profile?.tin) {
      throw new ApiError(400, "Business TIN is not available");
    }
    return { tin: profile.tin, profileType: "BUSINESS" };
  }

  const [profile] = await db.select().from(individualProfiles).where(eq(individualProfiles.userId, userId)).limit(1);
  if (!profile?.tin) {
    throw new ApiError(400, "Individual TIN is not available");
  }

  return { tin: profile.tin, profileType: "INDIVIDUAL" };
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
    receiptUrl: invoice.ipfsHash ? `https://gateway.pinata.cloud/ipfs/${invoice.ipfsHash}` : null,
    txHash: invoice.txHash,
    onChainRecordId: invoice.onChainRecordId,
    expiresAt: invoice.expiresAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString()
  };
}

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

    const profile = await getUserTin(req.authUser!.id);
    const monnifyRef = `TM-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const [invoice] = await db
      .insert(invoices)
      .values({
        userId: req.authUser!.id,
        taxItemCacheId: taxItem.id,
        onChainItemId: taxItem.onChainItemId,
        tin: profile.tin,
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
      taxItem: taxItem.name,
      tin: profile.tin
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

paymentsRouter.post("/monnify/init", requireAuth, async (req, res, next) => {
  try {
    const result = await monnifyClient.initTransaction(req.body as Record<string, unknown>);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

paymentsRouter.post("/monnify/webhook", async (req, res, next) => {
  try {
    const signature = req.header("monnify-signature") ?? "";
    const rawBody = JSON.stringify(req.body);
    const valid = monnifyClient.verifyWebhookSignature(rawBody, signature);

    if (!valid) {
      res.status(401).json({ message: "Invalid signature" });
      return;
    }

    const payload = webhookSchema.parse(req.body);
    const paymentReference = payload.paymentReference ?? payload.transactionReference;
    const status = String(payload.status ?? "PAID").toUpperCase();

    const [invoice] = payload.invoiceId
      ? await db.select().from(invoices).where(eq(invoices.id, payload.invoiceId)).limit(1)
      : paymentReference
        ? await db.select().from(invoices).where(eq(invoices.monnifyRef, paymentReference)).limit(1)
        : [];

    if (!invoice) {
      throw new ApiError(404, "Invoice not found for webhook");
    }

    const paidAt = new Date();
    const txHash = mockTxHash(invoice.id);
    const receipt = await pinataClient.pinReceipt(Buffer.from(JSON.stringify({ invoiceId: invoice.id, txHash })), invoice.id);
    const nextStatus = status.includes("FAIL") ? "FAILED" : "CONFIRMED";

    const [updated] = await db
      .update(invoices)
      .set({
        status: nextStatus,
        monnifyTxRef: paymentReference ?? invoice.monnifyRef,
        paidAt,
        confirmedAt: nextStatus === "CONFIRMED" ? paidAt : null,
        ipfsHash: receipt.cid,
        txHash,
        onChainRecordId: Math.floor(Date.now() / 1000)
      })
      .where(eq(invoices.id, invoice.id))
      .returning();

    const [user] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);
    if (user?.profileType === "BUSINESS") {
      await db.update(businessProfiles).set({ lastPaymentDate: paidAt }).where(eq(businessProfiles.userId, user.id));
    } else if (user?.profileType === "INDIVIDUAL") {
      await db.update(individualProfiles).set({ lastPaymentDate: paidAt }).where(eq(individualProfiles.userId, user.id));
    }

    res.status(202).json({ accepted: true, item: await serializeInvoice(updated) });
  } catch (error) {
    next(error);
  }
});

paymentsRouter.get("/receipt/:invoiceId", requireAuth, async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.invoiceId))).limit(1);
    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    res.status(200).json({
      invoiceId: invoice.id,
      status: invoice.status,
      receiptUrl: invoice.ipfsHash ? `https://gateway.pinata.cloud/ipfs/${invoice.ipfsHash}` : null,
      ipfsHash: invoice.ipfsHash,
      txHash: invoice.txHash
    });
  } catch (error) {
    next(error);
  }
});
