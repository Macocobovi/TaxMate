export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type ProfileType = "INDIVIDUAL" | "BUSINESS";

export type InvoiceStatus = "PENDING" | "PAID" | "CONFIRMED" | "FAILED" | "EXPIRED";
export type VerificationJobStatus = "PENDING" | "COMPLETED" | "FAILED";

export type TaxCategory =
  | "WHT"
  | "PAYE"
  | "VAT"
  | "INCOME_TAX"
  | "CORPORATE_TAX";
