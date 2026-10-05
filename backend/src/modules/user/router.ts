import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/client.js";
import { businessProfiles, individualProfiles, invoices, taxItemsCache, users } from "../../db/schema.js";
import { ApiError } from "../../utils/errors.js";

export const userRouter = Router();

function currencyFromNumeric(value: string): number {
  return Number.parseFloat(value);
}

async function getProfile(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (user.profileType === "BUSINESS") {
    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, userId)).limit(1);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      profileType: user.profileType,
      walletAddress: user.walletAddress,
      circleWalletId: user.circleWalletId,
      onChainRegistered: user.onChainRegistered,
      onChainTxHash: user.onChainTxHash,
      tin: profile?.tin,
      rcNumber: profile?.rcNumber,
      companyName: profile?.companyName,
      companyType: profile?.companyType,
      companyEmail: profile?.companyEmail,
      branchAddress: profile?.branchAddress,
      headOfficeAddress: profile?.headOfficeAddress,
      city: profile?.city,
      lga: profile?.lga,
      state: profile?.state,
      lastPaymentDate: profile?.lastPaymentDate?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString()
    };
  }

  const [profile] = await db.select().from(individualProfiles).where(eq(individualProfiles.userId, userId)).limit(1);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    profileType: user.profileType,
    walletAddress: user.walletAddress,
    circleWalletId: user.circleWalletId,
    onChainRegistered: user.onChainRegistered,
    onChainTxHash: user.onChainTxHash,
    tin: profile?.tin,
    firstname: profile?.firstname,
    lastname: profile?.lastname,
    middlename: profile?.middlename,
    dob: profile?.dob,
    gender: profile?.gender,
    phone: profile?.phone,
    photoUrl: profile?.photoUrl,
    lastPaymentDate: profile?.lastPaymentDate?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString()
  };
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
    amount: currencyFromNumeric(invoice.amount),
    amountLabel: `₦${currencyFromNumeric(invoice.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
    monnifyRef: invoice.monnifyRef,
    monnifyTxRef: invoice.monnifyTxRef,
    status: invoice.status,
    ipfsHash: invoice.ipfsHash,
    txHash: invoice.txHash,
    onChainRecordId: invoice.onChainRecordId,
    expiresAt: invoice.expiresAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString()
   
  };
} 

userRouter.get("/profile", async (req, res, next) => {
  try {
    const profile = await getProfile(req.authUser!.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
});

userRouter.get("/payment-history", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, req.authUser!.id))
      .orderBy(desc(invoices.createdAt));

    res.status(200).json({ items: await Promise.all(rows.map(serializeInvoice)) });
  } catch (error) {
    next(error);
  }
});

userRouter.get("/payment-history/:id", async (req, res, next) => {
  try {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, String(req.params.id)))
      .limit(1);

    if (!invoice || invoice.userId !== req.authUser!.id) {
      throw new ApiError(404, "Invoice not found");
    }

    res.status(200).json({ item: await serializeInvoice(invoice) });
  } catch (error) {
    next(error);
  }
});

userRouter.get("/wallet-address", async (req, res, next) => {
  try {
    const [user] = await db
      .select({ walletAddress: users.walletAddress, circleWalletId: users.circleWalletId })
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .limit(1);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});
