import bcrypt from "bcryptjs";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  adminAuditLogs,
  businessProfiles,
  individualProfiles,
  invoices,
  taxItemsCache,
  users
} from "../../db/schema.js";
import { requireRole } from "../../middleware/roles.js";
import { ApiError } from "../../utils/errors.js";
import { env } from "../../config/env.js";
import { onChainPaymentQueue } from "../../queues/index.js";
import { createTaxItemOnChain, setTaxItemActiveOnChain } from "../../services/onchain-tax-item-service.js";

export const adminRouter = Router();

adminRouter.use(requireRole(["ADMIN", "SUPER_ADMIN"]));

const statusSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"]) });
const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "SUPER_ADMIN"]).default("ADMIN")
});
const taxItemSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  category: z.enum(["WHT", "PAYE", "VAT", "INCOME_TAX", "CORPORATE_TAX"]),
  rateBasisPoints: z.coerce.number().int().min(0)
});
const toggleSchema = z.object({ isActive: z.boolean() });

function serializeTaxItem(row: typeof taxItemsCache.$inferSelect) {
  return {
    id: row.id,
    onChainItemId: row.onChainItemId,
    name: row.name,
    description: row.description,
    category: row.category,
    rateBasisPoints: row.rateBasisPoints,
    rateLabel: `${(row.rateBasisPoints / 100).toFixed(2)}%`,
    isActive: row.isActive,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null
  };
}

function amountNumber(value: string): number {
  return Number.parseFloat(value);
}

async function audit(adminId: string, action: string, entityType: string, entityId: string, metadata?: unknown): Promise<void> {
  await db.insert(adminAuditLogs).values({
    adminId,
    action,
    entityType,
    entityId,
    metadata: metadata as Record<string, unknown> | undefined
  });
}

async function serializeUser(user: typeof users.$inferSelect) {
  const [individual] = await db.select().from(individualProfiles).where(eq(individualProfiles.userId, user.id)).limit(1);
  const [business] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, user.id)).limit(1);
  const displayName = business?.companyName ?? ([individual?.firstname, individual?.lastname].filter(Boolean).join(" ") || user.email);

  return {
    id: user.id,
    email: user.email,
    displayName,
    role: user.role,
    status: user.status,
    profileType: user.profileType,
    tin: business?.tin ?? individual?.tin ?? null,
    walletAddress: user.walletAddress,
    onChainRegistered: user.onChainRegistered,
    onChainTxHash: user.onChainTxHash,
    createdAt: user.createdAt.toISOString()
  };
}

async function serializeInvoice(invoice: typeof invoices.$inferSelect) {
  const [taxItem] = await db
    .select()
    .from(taxItemsCache)
    .where(eq(taxItemsCache.onChainItemId, invoice.onChainItemId))
    .limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);

  return {
    id: invoice.id,
    userId: invoice.userId,
    userEmail: user?.email ?? null,
    onChainItemId: invoice.onChainItemId,
    taxItemName: taxItem?.name ?? `Tax item #${invoice.onChainItemId}`,
    category: taxItem?.category ?? null,
    tin: invoice.tin,
    amount: amountNumber(invoice.amount),
    amountLabel: `₦${amountNumber(invoice.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
    status: invoice.status,
    monnifyRef: invoice.monnifyRef,
    txHash: invoice.txHash,
    createdAt: invoice.createdAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null
  };
}

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    res.status(200).json({ items: await Promise.all(rows.map(serializeUser)) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users/:id", async (req, res, next) => {
  try {
    const userId = String(req.params.id);
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    res.status(200).json({ item: await serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/status", requireRole(["SUPER_ADMIN"]), async (req, res, next) => {
  try {
    const payload = statusSchema.parse(req.body);
    const [updated] = await db
      .update(users)
      .set({ status: payload.status, updatedAt: new Date() })
      .where(eq(users.id, String(req.params.id)))
      .returning();

    if (!updated) {
      throw new ApiError(404, "User not found");
    }

    await audit(req.authUser!.id, "USER_STATUS_UPDATED", "USER", updated.id, payload);
    res.status(200).json({ item: await serializeUser(updated) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/payments", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;

    let rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
    if (status) rows = rows.filter((row) => row.status === status);
    if (userId) rows = rows.filter((row) => row.userId === userId);

    res.status(200).json({ items: await Promise.all(rows.map(serializeInvoice)) });
  } catch (error) {
    next(error);
  }
});

// Re-queue a paid invoice whose on-chain recording failed/stalled.
adminRouter.post("/payments/:id/retry-onchain", async (req, res, next) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, String(req.params.id))).limit(1);
    if (!invoice) {
      throw new ApiError(404, "Invoice not found");
    }
    if (invoice.status !== "PAID") {
      throw new ApiError(409, `Invoice is ${invoice.status.toLowerCase()}, not awaiting on-chain recording`);
    }

    const jobId = `record-${invoice.id}`;
    await onChainPaymentQueue.remove(jobId).catch(() => undefined);
    await onChainPaymentQueue.add(
      "record-tax-payment",
      { invoiceId: invoice.id },
      { jobId, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: false }
    );

    await audit(req.authUser!.id, "PAYMENT_ONCHAIN_RETRY", "INVOICE", invoice.id);
    res.status(202).json({ requeued: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/tax-items", async (_req, res, next) => {
  try {
    const rows = await db.select().from(taxItemsCache).orderBy(desc(taxItemsCache.onChainItemId));
    res.status(200).json({ items: rows.map(serializeTaxItem) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/tax-items", async (req, res, next) => {
  try {
    const payload = taxItemSchema.parse(req.body);
    const { onChainItemId, txHash } = await createTaxItemOnChain(payload);

    const [created] = await db
      .insert(taxItemsCache)
      .values({
        onChainItemId,
        name: payload.name,
        description: payload.description,
        category: payload.category,
        rateBasisPoints: payload.rateBasisPoints,
        isActive: true,
        createdAtChain: new Date(),
        lastSyncedAt: new Date()
      })
      .returning();

    await audit(req.authUser!.id, "TAX_ITEM_CREATED", "TAX_ITEM", String(onChainItemId), { name: payload.name, txHash });
    res.status(201).json({ item: serializeTaxItem(created) });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/tax-items/:id", async (req, res, next) => {
  try {
    const { isActive } = toggleSchema.parse(req.body);
    const onChainItemId = Number(req.params.id);
    const [existing] = await db.select().from(taxItemsCache).where(eq(taxItemsCache.onChainItemId, onChainItemId)).limit(1);
    if (!existing) {
      throw new ApiError(404, "Tax item not found");
    }

    const { txHash } = await setTaxItemActiveOnChain(onChainItemId, isActive);
    const [updated] = await db
      .update(taxItemsCache)
      .set({ isActive, lastSyncedAt: new Date() })
      .where(eq(taxItemsCache.onChainItemId, onChainItemId))
      .returning();

    await audit(req.authUser!.id, "TAX_ITEM_UPDATED", "TAX_ITEM", String(onChainItemId), { isActive, txHash });
    res.status(200).json({ item: serializeTaxItem(updated) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/system", requireRole(["SUPER_ADMIN"]), async (_req, res, next) => {
  try {
    const taxItems = await db.select().from(taxItemsCache);
    res.status(200).json({
      contractAddress: env.TAXMATE_CONTRACT_ADDRESS ?? null,
      network: env.BASE_RPC_URL ? "Base Sepolia" : null,
      adminWalletConfigured: Boolean(env.CIRCLE_ADMIN_WALLET_ID),
      taxItemCount: taxItems.length,
      integrations: {
        monnify: Boolean(env.MONNIFY_API_KEY && env.MONNIFY_SECRET_KEY && env.MONNIFY_CONTRACT_CODE),
        circle: Boolean(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET),
        pinata: Boolean(env.PINATA_JWT),
        resend: Boolean(env.RESEND_API_KEY),
        verifyme: Boolean(env.VERIFYME_API_KEY)
      }
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/analytics/overview", async (_req, res, next) => {
  try {
    const [userRows, paymentRows, taxRows] = await Promise.all([
      db.select().from(users),
      db.select().from(invoices),
      db.select().from(taxItemsCache),
    ]);

    const confirmedPayments = paymentRows.filter((payment) => payment.status === "CONFIRMED" || payment.status === "PAID");
    const totalRevenue = confirmedPayments.reduce((sum, payment) => sum + amountNumber(payment.amount), 0);

    res.status(200).json({
      kpis: {
        totalUsers: userRows.length,
        activeUsers: userRows.filter((user) => user.status === "ACTIVE").length,
        totalRevenue,
        totalRevenueLabel: `₦${totalRevenue.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
        activeTaxItems: taxRows.filter((item) => item.isActive).length,
        pendingPayments: paymentRows.filter((payment) => payment.status === "PENDING").length,
        confirmedPayments: confirmedPayments.length,
        pendingChainConfirms: paymentRows.filter((payment) => payment.status === "PAID" && !payment.txHash).length
      }
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/analytics/by-category", async (_req, res, next) => {
  try {
    const rows = await db.select().from(invoices);
    const taxRows = await db.select().from(taxItemsCache);
    const categoryMap = new Map(taxRows.map((item) => [item.onChainItemId, item.category]));
    const totals = new Map<string, { category: string; count: number; total: number }>();

    for (const invoice of rows) {
      const category = categoryMap.get(invoice.onChainItemId) ?? "UNKNOWN";
      const current = totals.get(category) ?? { category, count: 0, total: 0 };
      current.count += 1;
      current.total += amountNumber(invoice.amount);
      totals.set(category, current);
    }

    res.status(200).json({
      items: Array.from(totals.values()).map((item) => ({
        ...item,
        totalLabel: `₦${item.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`
      }))
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/admins", requireRole(["SUPER_ADMIN"]), async (req, res, next) => {
  try {
    const payload = createAdminSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const [created] = await db
      .insert(users)
      .values({
        email: payload.email,
        passwordHash,
        role: payload.role,
        status: "ACTIVE"
      })
      .returning();

    await audit(req.authUser!.id, "ADMIN_CREATED", "USER", created.id, { role: payload.role });
    res.status(201).json({ item: await serializeUser(created) });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/admins/:id", requireRole(["SUPER_ADMIN"]), async (req, res, next) => {
  try {
    const [updated] = await db
      .update(users)
      .set({ role: "USER", updatedAt: new Date() })
      .where(eq(users.id, String(req.params.id)))
      .returning();

    if (!updated) {
      throw new ApiError(404, "Admin not found");
    }

    await audit(req.authUser!.id, "ADMIN_ROLE_REMOVED", "USER", updated.id);
    res.status(200).json({ id: updated.id, removed: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-log", requireRole(["SUPER_ADMIN"]), async (_req, res, next) => {
  try {
    const rows = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt));
    res.status(200).json({
      items: rows.map((row) => ({
        id: row.id,
        adminId: row.adminId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
});
