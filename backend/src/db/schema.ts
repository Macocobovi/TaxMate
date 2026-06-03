import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["USER", "ADMIN", "SUPER_ADMIN"]);
export const statusEnum = pgEnum("user_status", ["PENDING", "ACTIVE", "SUSPENDED"]);
export const profileTypeEnum = pgEnum("profile_type", ["INDIVIDUAL", "BUSINESS"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["PENDING", "PAID", "CONFIRMED", "FAILED", "EXPIRED"]);
export const verificationJobStatusEnum = pgEnum("verification_job_status", ["PENDING", "COMPLETED", "FAILED"]);
export const taxCategoryEnum = pgEnum("tax_category", ["WHT", "PAYE", "VAT", "INCOME_TAX", "CORPORATE_TAX"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordHash: varchar("password_hash", { length: 255 }),
  role: roleEnum("role").notNull().default("USER"),
  status: statusEnum("status").notNull().default("PENDING"),
  profileType: profileTypeEnum("profile_type"),
  walletAddress: varchar("wallet_address", { length: 42 }),
  circleWalletId: varchar("circle_wallet_id", { length: 255 }),
  onChainRegistered: boolean("on_chain_registered").notNull().default(false),
  onChainTxHash: varchar("on_chain_tx_hash", { length: 66 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const individualProfiles = pgTable("individual_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tin: varchar("tin", { length: 20 }).notNull().unique(),
  ninHash: varchar("nin_hash", { length: 255 }).notNull().unique(),
  firstname: varchar("firstname", { length: 100 }),
  lastname: varchar("lastname", { length: 100 }),
  middlename: varchar("middlename", { length: 100 }),
  dob: varchar("dob", { length: 20 }),
  gender: varchar("gender", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const businessProfiles = pgTable("business_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tin: varchar("tin", { length: 20 }).notNull().unique(),
  rcNumber: varchar("rc_number", { length: 50 }).notNull().unique(),
  verifymeVerificationId: varchar("verifyme_verification_id", { length: 100 }),
  verifymeReference: varchar("verifyme_reference", { length: 100 }),
  companyName: varchar("company_name", { length: 255 }),
  companyType: varchar("company_type", { length: 100 }),
  companyEmail: varchar("company_email", { length: 255 }),
  branchAddress: text("branch_address"),
  headOfficeAddress: text("head_office_address"),
  city: varchar("city", { length: 100 }),
  lga: varchar("lga", { length: 100 }),
  state: varchar("state", { length: 100 }),
  classification: varchar("classification", { length: 100 }),
  shareCapital: varchar("share_capital", { length: 100 }),
  isActive: boolean("is_active").notNull().default(true),
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const businessVerificationJobs = pgTable("business_verification_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  verifymeVerificationId: varchar("verifyme_verification_id", { length: 100 }).notNull(),
  verifymeReference: varchar("verifyme_reference", { length: 100 }),
  rcNumber: varchar("rc_number", { length: 50 }).notNull(),
  status: verificationJobStatusEnum("status").notNull().default("PENDING"),
  resultData: jsonb("result_data"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});

export const taxItemsCache = pgTable("tax_items_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  onChainItemId: integer("on_chain_item_id").notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: taxCategoryEnum("category").notNull(),
  rateBasisPoints: integer("rate_basis_points").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAtChain: timestamp("created_at_chain", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow()
});

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taxItemCacheId: uuid("tax_item_cache_id").references(() => taxItemsCache.id, { onDelete: "set null" }),
  onChainItemId: integer("on_chain_item_id").notNull(),
  tin: varchar("tin", { length: 20 }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  monnifyRef: varchar("monnify_ref", { length: 255 }).notNull().unique(),
  monnifyTxRef: varchar("monnify_tx_ref", { length: 255 }),
  status: invoiceStatusEnum("status").notNull().default("PENDING"),
  ipfsHash: varchar("ipfs_hash", { length: 255 }),
  txHash: varchar("tx_hash", { length: 66 }),
  onChainRecordId: integer("on_chain_record_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: uuid("admin_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }).notNull(),
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  otpHash: varchar("otp_hash", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const registrationSessions = pgTable("registration_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  sessionTokenHash: varchar("session_token_hash", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
