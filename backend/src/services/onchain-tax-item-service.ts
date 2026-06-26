import { asc, eq, lte, sql } from "drizzle-orm";
import { circleExecutionMap } from "../blockchain/taxmateContract.js";
import { taxmateReader } from "../blockchain/reader.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/client.js";
import { taxItemsCache } from "../db/schema.js";
import { circleClient } from "../integrations/circle.js";
import { sleep } from "../utils/sleep.js";

// DB tax_category enum value -> on-chain TaxCategory enum index
// (WHT, PAYE, VAT, CONSUMPTION, INCOME_TAX, CORPORATE_TAX, OTHER).
const CATEGORY_TO_ENUM: Record<string, number> = {
  WHT: 0,
  PAYE: 1,
  VAT: 2,
  INCOME_TAX: 4,
  CORPORATE_TAX: 5
};

function onChainWritesEnabled(): boolean {
  return Boolean(
    env.CIRCLE_API_KEY &&
      env.CIRCLE_ENTITY_SECRET &&
      env.CIRCLE_ADMIN_WALLET_ID &&
      taxmateReader.isConfigured()
  );
}

async function pollTxHash(transactionId: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const tx = await circleClient.getTransaction(transactionId);
    const state = tx.state.toUpperCase();
    if (state === "CONFIRMED" || state === "COMPLETE") {
      return tx.txHash ?? "";
    }
    if (["FAILED", "REJECTED", "CANCELLED", "DENIED"].includes(state)) {
      const detail = [tx.errorReason, tx.errorDetails].filter(Boolean).join(": ");
      throw new Error(`createTaxItem transaction ${transactionId} ended in state ${state}${detail ? ` (${detail})` : ""}`);
    }
    await sleep(2000);
  }
  throw new Error(`createTaxItem transaction ${transactionId} timed out`);
}

async function createOnChain(row: typeof taxItemsCache.$inferSelect): Promise<number> {
  const category = CATEGORY_TO_ENUM[row.category];
  if (category === undefined) {
    throw new Error(`Unsupported tax category for on-chain creation: ${row.category}`);
  }

  const execution = await circleClient.executeContract({
    walletId: env.CIRCLE_ADMIN_WALLET_ID!,
    abiFunctionSignature: circleExecutionMap.taxItemCreate, // createTaxItem(string,string,uint8,uint256)
    abiParameters: [row.name, row.description ?? row.name, String(category), String(row.rateBasisPoints)]
  });

  const txHash = await pollTxHash(execution.transactionId);
  return taxmateReader.readCreatedItemId(txHash);
}

// Ensures the tax item is present on-chain before an invoice is created. Creates
// any not-yet-created items with id <= target in ascending order, so the contract's
// auto-incremented ids stay aligned with the cache. Returns the effective on-chain
// id for the requested item.
export async function ensureTaxItemOnChain(targetOnChainItemId: number): Promise<number> {
  if (!onChainWritesEnabled()) {
    logger.warn({ targetOnChainItemId }, "On-chain writes not configured; skipping tax item provisioning");
    return targetOnChainItemId;
  }

  if (await taxmateReader.taxItemExists(targetOnChainItemId)) {
    return targetOnChainItemId;
  }

  const rows = await db
    .select()
    .from(taxItemsCache)
    .where(lte(taxItemsCache.onChainItemId, targetOnChainItemId))
    .orderBy(asc(taxItemsCache.onChainItemId));

  let effectiveId = targetOnChainItemId;
  for (const row of rows) {
    if (await taxmateReader.taxItemExists(row.onChainItemId)) {
      continue;
    }

    const assignedId = await createOnChain(row);
    logger.info({ name: row.name, expected: row.onChainItemId, assignedId }, "Tax item created on-chain");

    if (assignedId !== row.onChainItemId) {
      // Keep the cache aligned with what the contract actually assigned.
      await db
        .update(taxItemsCache)
        .set({ onChainItemId: assignedId, lastSyncedAt: new Date() })
        .where(eq(taxItemsCache.id, row.id));
      if (row.onChainItemId === targetOnChainItemId) {
        effectiveId = assignedId;
      }
    } else {
      await db.update(taxItemsCache).set({ lastSyncedAt: new Date() }).where(eq(taxItemsCache.id, row.id));
    }
  }

  return effectiveId;
}

export interface NewTaxItemInput {
  name: string;
  description: string;
  category: string;
  rateBasisPoints: number;
}

// Creates a new tax item on-chain (createTaxItem) and returns the contract-assigned
// id. In dev without on-chain writes, assigns the next local id so admins can still
// manage the catalogue. The caller persists the cache row.
export async function createTaxItemOnChain(input: NewTaxItemInput): Promise<{ onChainItemId: number; txHash: string | null }> {
  const category = CATEGORY_TO_ENUM[input.category];
  if (category === undefined) {
    throw new Error(`Unsupported tax category: ${input.category}`);
  }

  if (!onChainWritesEnabled()) {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(${taxItemsCache.onChainItemId}), 0)` })
      .from(taxItemsCache);
    return { onChainItemId: Number(row?.value ?? 0) + 1, txHash: null };
  }

  const execution = await circleClient.executeContract({
    walletId: env.CIRCLE_ADMIN_WALLET_ID!,
    abiFunctionSignature: circleExecutionMap.taxItemCreate, // createTaxItem(string,string,uint8,uint256)
    abiParameters: [input.name, input.description, String(category), String(input.rateBasisPoints)]
  });
  const txHash = await pollTxHash(execution.transactionId);
  const onChainItemId = await taxmateReader.readCreatedItemId(txHash);
  return { onChainItemId, txHash };
}

// Activates/deactivates a tax item on-chain (updateTaxItem). No-op tx in dev.
export async function setTaxItemActiveOnChain(onChainItemId: number, isActive: boolean): Promise<{ txHash: string | null }> {
  if (!onChainWritesEnabled()) {
    return { txHash: null };
  }
  const execution = await circleClient.executeContract({
    walletId: env.CIRCLE_ADMIN_WALLET_ID!,
    abiFunctionSignature: circleExecutionMap.taxItemToggle, // updateTaxItem(uint256,bool)
    abiParameters: [String(onChainItemId), isActive]
  });
  const txHash = await pollTxHash(execution.transactionId);
  return { txHash };
}
