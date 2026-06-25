import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export class ResendClient {
  async sendEmail(params: SendEmailParams): Promise<{ id?: string; queued: boolean }> {
    // A display name ("Taxmate <noreply@...>") reads as more trustworthy than a
    // bare address. RESEND_FROM_EMAIL stays a plain address so env validation passes.
    const from = params.from ?? `Taxmate <${env.RESEND_FROM_EMAIL}>`;

    // No API key configured: keep local/dev usable without sending real mail.
    // (OTP flows still return `debugOtp` outside production.)
    if (!env.RESEND_API_KEY) {
      logger.warn({ to: params.to, subject: params.subject }, "RESEND_API_KEY not set; skipping email send");
      return { queued: false };
    }

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Resend email send failed");
      throw new Error("Could not send the email right now. Please try again shortly.");
    }

    const data = (await response.json()) as { id?: string };
    logger.info({ id: data.id, to: params.to }, "Email sent via Resend");
    return { id: data.id, queued: true };
  }
}

export const resendClient = new ResendClient();
