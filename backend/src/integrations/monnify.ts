import crypto from "node:crypto";
import { env } from "../config/env.js";

export class MonnifyClient {
  private readonly baseUrl = env.MONNIFY_BASE_URL;

  async initTransaction(payload: Record<string, unknown>): Promise<unknown> {
    return {
      request: `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
      payload,
      stub: true
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = env.MONNIFY_SECRET_KEY ?? "";
    if (!secret) {
      return true;
    }

    const digest = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    return digest === signature;
  }
}

export const monnifyClient = new MonnifyClient();
