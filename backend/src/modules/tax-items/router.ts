import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { taxItemsCache } from "../../db/schema.js";
import { requireRole } from "../../middleware/roles.js";
import { ApiError } from "../../utils/errors.js";

export const taxItemsRouter = Router();

const demoTaxItems = [
  {
    onChainItemId: 1,
    name: "Value Added Tax",
    description: "Monthly VAT remittance for taxable goods and services.",
    category: "VAT" as const,
    rateBasisPoints: 750
  },
  {
    onChainItemId: 2,
    name: "Pay As You Earn",
    description: "Employee PAYE remittance for payroll obligations.",
    category: "PAYE" as const,
    rateBasisPoints: 1000
  },
  {
    onChainItemId: 3,
    name: "Withholding Tax",
    description: "Vendor and contractor withholding deductions.",
    category: "WHT" as const,
    rateBasisPoints: 500
  },
  {
    onChainItemId: 4,
    name: "Company Income Tax",
    description: "Corporate income tax for registered businesses.",
    category: "CORPORATE_TAX" as const,
    rateBasisPoints: 3000
  },
  {
    onChainItemId: 5,
    name: "Personal Income Tax",
    description: "Annual individual income tax obligation.",
    category: "INCOME_TAX" as const,
    rateBasisPoints: 1200
  }
];

const createTaxItemSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.enum(["WHT", "PAYE", "VAT", "INCOME_TAX", "CORPORATE_TAX"]),
  rateBasisPoints: z.coerce.number().int().min(0)
});

const statusSchema = z.object({ isActive: z.boolean() });

async function ensureDemoTaxItems(): Promise<void> {
  const existing = await db.select({ id: taxItemsCache.id }).from(taxItemsCache).limit(1);
  if (existing.length > 0) {
    return;
  }

  await db.insert(taxItemsCache).values(
    demoTaxItems.map((item) => ({
      ...item,
      isActive: true,
      createdAtChain: new Date()
    }))
  );
}

function formatRate(rateBasisPoints: number): string {
  return `${(rateBasisPoints / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;
}

function serializeTaxItem(item: typeof taxItemsCache.$inferSelect) {
  return {
    id: item.id,
    onChainItemId: item.onChainItemId,
    name: item.name,
    description: item.description,
    category: item.category,
    rateBasisPoints: item.rateBasisPoints,
    rateLabel: formatRate(item.rateBasisPoints),
    isActive: item.isActive,
    createdAtChain: item.createdAtChain?.toISOString() ?? null,
    lastSyncedAt: item.lastSyncedAt.toISOString()
  };
}

taxItemsRouter.get("/", async (_req, res, next) => {
  try {
    await ensureDemoTaxItems();
    const rows = await db.select().from(taxItemsCache).orderBy(desc(taxItemsCache.isActive), taxItemsCache.onChainItemId);
    res.status(200).json({ items: rows.map(serializeTaxItem) });
  } catch (error) {
    next(error);
  }
});

taxItemsRouter.get("/:id", async (req, res, next) => {
  try {
    await ensureDemoTaxItems();
    const onChainItemId = Number(req.params.id);
    const [item] = await db
      .select()
      .from(taxItemsCache)
      .where(eq(taxItemsCache.onChainItemId, onChainItemId))
      .limit(1);

    if (!item) {
      throw new ApiError(404, "Tax item not found");
    }

    res.status(200).json({ item: serializeTaxItem(item) });
  } catch (error) {
    next(error);
  }
});

taxItemsRouter.post("/", requireRole(["ADMIN", "SUPER_ADMIN"]), async (req, res, next) => {
  try {
    const payload = createTaxItemSchema.parse(req.body);
    const rows = await db.select().from(taxItemsCache);
    const nextItemId = rows.reduce((max, item) => Math.max(max, item.onChainItemId), 0) + 1;
    const [created] = await db
      .insert(taxItemsCache)
      .values({
        onChainItemId: nextItemId,
        ...payload,
        isActive: true,
        createdAtChain: new Date()
      })
      .returning();

    res.status(201).json({ item: serializeTaxItem(created) });
  } catch (error) {
    next(error);
  }
});

taxItemsRouter.patch("/:id/status", requireRole(["ADMIN", "SUPER_ADMIN"]), async (req, res, next) => {
  try {
    const payload = statusSchema.parse(req.body);
    const onChainItemId = Number(req.params.id);
    const [updated] = await db
      .update(taxItemsCache)
      .set({ isActive: payload.isActive, lastSyncedAt: new Date() })
      .where(eq(taxItemsCache.onChainItemId, onChainItemId))
      .returning();

    if (!updated) {
      throw new ApiError(404, "Tax item not found");
    }

    res.status(200).json({ item: serializeTaxItem(updated) });
  } catch (error) {
    next(error);
  }
});

taxItemsRouter.post("/sync", requireRole(["SUPER_ADMIN"]), async (_req, res, next) => {
  try {
    await ensureDemoTaxItems();
    res.status(202).json({ message: "Tax item catalogue is ready", synced: true });
  } catch (error) {
    next(error);
  }
});
