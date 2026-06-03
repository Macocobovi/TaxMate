import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { businessVerificationJobs } from "../../db/schema.js";
import { verifyMeClient } from "../../integrations/verifyme.js";
import { tinService, type TinType } from "../../services/tin-service.js";
import { registrationSessionService } from "../../services/registration-session-service.js";
import { ApiError } from "../../utils/errors.js";

export const identityRouter = Router();

const ninSchema = z.object({ nin: z.string().min(10) });
const businessSchema = z.object({
  rcNumber: z.string().min(2),
  applicant: z.object({
    idType: z.string().default("bvn"),
    idNumber: z.string().min(3),
    firstname: z.string().min(2),
    lastname: z.string().min(2)
  })
});
const tinTypeSchema = z.enum(["INDIVIDUAL", "BUSINESS"]);
const reserveTinSchema = z.object({
  type: tinTypeSchema,
  tin: z.string().min(3),
  email: z.string().email(),
  registrationSessionToken: z.string().min(20)
});

function parseTinType(value: unknown): TinType {
  return tinTypeSchema.parse(value ?? "INDIVIDUAL");
}

identityRouter.get("/available-tins", async (req, res, next) => {
  try {
    const type = parseTinType(req.query.type);
    const items = await tinService.listAvailable(type);
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

identityRouter.post("/reserve-tin", async (req, res, next) => {
  try {
    const payload = reserveTinSchema.parse(req.body);
    await registrationSessionService.assertValid(payload.registrationSessionToken, payload.email);
    const item = await tinService.reserve(payload.type, payload.tin, payload.email);
    res.status(200).json({ item });
  } catch (error) {
    next(error);
  }
});

identityRouter.post("/release-tin", async (req, res, next) => {
  try {
    const payload = reserveTinSchema.parse(req.body);
    await registrationSessionService.assertValid(payload.registrationSessionToken, payload.email);
    tinService.release(payload.tin, payload.email);
    res.status(200).json({ released: true });
  } catch (error) {
    next(error);
  }
});

identityRouter.post("/verify-nin", async (req, res, next) => {
  try {
    const { nin } = ninSchema.parse(req.body);
    const result = await verifyMeClient.verifyNin(nin);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

identityRouter.post("/verify-business", async (req, res, next) => {
  try {
    const payload = businessSchema.parse(req.body);
    const result = await verifyMeClient.submitBusinessVerification(payload);

    const [job] = await db
      .insert(businessVerificationJobs)
      .values({
        rcNumber: payload.rcNumber,
        verifymeVerificationId: result.verificationId,
        verifymeReference: result.reference,
        status: "PENDING",
        resultData: result.raw
      })
      .returning();

    res.status(202).json({ jobId: job.id, status: "PENDING" });
  } catch (error) {
    next(error);
  }
});

identityRouter.get("/business-verification-status/:jobId", async (req, res, next) => {
  try {
    const [job] = await db
      .select()
      .from(businessVerificationJobs)
      .where(eq(businessVerificationJobs.id, req.params.jobId))
      .limit(1);

    if (!job) {
      throw new ApiError(404, "Verification job not found");
    }

    const result = await verifyMeClient.getBusinessVerification(job.verifymeVerificationId);

    if (result.status === "COMPLETED") {
      await db
        .update(businessVerificationJobs)
        .set({ status: "COMPLETED", resultData: result.raw, completedAt: new Date() })
        .where(and(eq(businessVerificationJobs.id, job.id)));
    } else if (result.status === "FAILED") {
      await db
        .update(businessVerificationJobs)
        .set({ status: "FAILED", resultData: result.raw, errorMessage: "VerifyMe business verification failed" })
        .where(and(eq(businessVerificationJobs.id, job.id)));
    }

    res.status(200).json({ jobId: job.id, status: result.status });
  } catch (error) {
    next(error);
  }
});
