import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { otpCodes } from "../db/schema.js";
import { generateOtp, sha256 } from "../utils/crypto.js";
import { ApiError } from "../utils/errors.js";
import { resendClient } from "../integrations/resend.js";
import { env } from "../config/env.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export class OtpService {
   async sendOtp(email: string): Promise<{ debugOtp?: string }> {
    try {
      const otp = generateOtp();

      await db.insert(otpCodes).values({
        email,
        otpHash: sha256(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS)
      });

      await resendClient.sendEmail({
        to: email,
        subject: "Taxmate OTP",
        html: `Your OTP is <b>${otp}</b>. It expires in 10 minutes.`
      });

      return env.NODE_ENV === "production" ? {} : { debugOtp: otp };
    } catch (error) {
      throw error;
    }
  }

  async verifyOtp(email: string, otp: string): Promise<void> {
    const [record] = await db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.email, email), isNull(otpCodes.usedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);

    if (!record) {
      throw new ApiError(400, "OTP not found");
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new ApiError(400, "OTP expired");
    }

    if (record.attemptCount >= OTP_MAX_ATTEMPTS) {
      throw new ApiError(429, "OTP attempts exceeded");
    }

    if (record.otpHash !== sha256(otp)) {
      await db
        .update(otpCodes)
        .set({ attemptCount: record.attemptCount + 1 })
        .where(eq(otpCodes.id, record.id));
      throw new ApiError(400, "Invalid OTP");
    }

    await db
      .update(otpCodes)
      .set({ usedAt: new Date() })
      .where(eq(otpCodes.id, record.id));
  }
}

export const otpService = new OtpService();
