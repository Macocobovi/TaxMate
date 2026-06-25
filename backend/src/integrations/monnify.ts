import crypto from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

// Monnify API v1: https://developers.monnify.com/api
//  - Auth:  POST {base}/api/v1/auth/login         (Basic base64(apiKey:secretKey)) -> responseBody.accessToken
//  - Init:  POST {base}/api/v1/merchant/transactions/init-transaction (Bearer)     -> responseBody.checkoutUrl
//  - Webhook signature: `monnify-signature` header = HMAC-SHA512(rawBody, secretKey)

export interface InitTransactionInput {
  amount: number;
  paymentReference: string;
  customerName: string;
  customerEmail: string;
  paymentDescription?: string;
  currencyCode?: string;
  redirectUrl?: string;
}

export interface InitTransactionResult {
  checkoutUrl: string | null;
  transactionReference: string | null;
  paymentReference: string;
  raw: unknown;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class MonnifyClient {
  private readonly baseUrl = env.MONNIFY_BASE_URL;
  private cachedToken: CachedToken | null = null;

  private isConfigured(): boolean {
    return Boolean(env.MONNIFY_API_KEY && env.MONNIFY_SECRET_KEY && env.MONNIFY_CONTRACT_CODE);
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Re-use the token until ~1 minute before it expires.
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }

    const basic = Buffer.from(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`).toString("base64");
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` }
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Monnify auth failed");
      throw new Error("Monnify authentication failed. Please check the API credentials.");
    }

    const json = (await response.json()) as { responseBody?: { accessToken?: string; expiresIn?: number } };
    const token = json.responseBody?.accessToken;
    if (!token) {
      throw new Error("Monnify auth failed: no accessToken returned");
    }

    const expiresInSeconds = json.responseBody?.expiresIn ?? 3600;
    this.cachedToken = { token, expiresAt: now + expiresInSeconds * 1000 };
    return token;
  }

  async initTransaction(input: InitTransactionInput): Promise<InitTransactionResult> {
    // Not configured: keep local/dev usable without contacting Monnify.
    if (!this.isConfigured()) {
      logger.warn({ paymentReference: input.paymentReference }, "Monnify not configured; returning stub init transaction");
      return {
        checkoutUrl: null,
        transactionReference: null,
        paymentReference: input.paymentReference,
        raw: { stub: true, input }
      };
    }

    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amount,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        paymentReference: input.paymentReference,
        paymentDescription: input.paymentDescription ?? "Taxmate tax payment",
        currencyCode: input.currencyCode ?? "NGN",
        contractCode: env.MONNIFY_CONTRACT_CODE,
        redirectUrl: input.redirectUrl ?? `${env.NEXT_PUBLIC_APP_URL}/dashboard/payments`,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Monnify init transaction failed");
      throw new Error("Could not start the Monnify payment. Please try again.");
    }

    const json = (await response.json()) as {
      responseBody?: { checkoutUrl?: string; transactionReference?: string; paymentReference?: string };
    };
    const responseBody = json.responseBody;

    return {
      checkoutUrl: responseBody?.checkoutUrl ?? null,
      transactionReference: responseBody?.transactionReference ?? null,
      paymentReference: responseBody?.paymentReference ?? input.paymentReference,
      raw: json
    };
  }

  // Reconcile a transaction by our paymentReference. Returns the Monnify
  // paymentStatus (PAID, OVERPAID, PARTIALLY_PAID, PENDING, ABANDONED,
  // CANCELLED, FAILED, REVERSED, EXPIRED) — used as a webhook-independent fallback.
  async getTransactionStatus(paymentReference: string): Promise<{ paymentStatus: string; raw: unknown }> {
    if (!this.isConfigured()) {
      return { paymentStatus: "PENDING", raw: { stub: true } };
    }

    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(paymentReference)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const body = await response.text();
      // 404 = Monnify has no transaction for this reference yet (e.g. the invoice
      // was never taken to checkout). Treat as "not found", not an error.
      if (response.status === 404) {
        logger.info({ paymentReference }, "Monnify has no transaction for this reference yet");
        return { paymentStatus: "NOT_FOUND", raw: body };
      }
      logger.error({ status: response.status, body }, "Monnify transaction query failed");
      throw new Error("Could not verify this payment with Monnify right now. Please try again shortly.");
    }

    const json = (await response.json()) as { responseBody?: { paymentStatus?: string } };
    return { paymentStatus: json.responseBody?.paymentStatus ?? "PENDING", raw: json };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = env.MONNIFY_SECRET_KEY ?? "";
    // Without a secret (local/dev) we cannot verify; accept so the flow is testable.
    if (!secret) {
      return true;
    }

    const digest = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    return digest === signature;
  }
}

export const monnifyClient = new MonnifyClient();
