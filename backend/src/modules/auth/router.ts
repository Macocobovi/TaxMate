import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { circleExecutionMap } from "../../blockchain/taxmateContract.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { db } from "../../db/client.js";
import { businessProfiles, businessVerificationJobs, individualProfiles, users } from "../../db/schema.js";
import { circleClient } from "../../integrations/circle.js";
import { verifyMeClient } from "../../integrations/verifyme.js";
import { memoryRateLimit } from "../../middleware/rate-limit.js";
import { requireAuth } from "../../middleware/auth.js";
import { otpService } from "../../services/otp-service.js";
import { registrationSessionService } from "../../services/registration-session-service.js";
import { tinService } from "../../services/tin-service.js";
import { tokenService } from "../../services/token-service.js";
import { sha256 } from "../../utils/crypto.js";
import { ApiError } from "../../utils/errors.js";
import { sleep } from "../../utils/sleep.js";

export const authRouter = Router();

type CreatedAuthUser = typeof users.$inferSelect;

const sendOtpSchema = z.object({ email: z.string().email() });
const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/)
});

const individualRegisterSchema = z.object({
  registrationSessionToken: z.string().min(20),
  email: z.string().email(),
  password: z.string().min(8),
  nin: z.string().min(10),
  tin: z.string().min(3)
});

const businessSubmitSchema = z.object({
  registrationSessionToken: z.string().min(20),
  email: z.string().email(),
  rcNumber: z.string().min(2),
  applicant: z.object({
    idType: z.string().default("bvn"),
    idNumber: z.string().min(3),
    firstname: z.string().min(2),
    lastname: z.string().min(2)
  })
});

const businessCompleteSchema = z.object({
  registrationSessionToken: z.string().min(20),
  email: z.string().email(),
  jobId: z.string().uuid(),
  password: z.string().min(8),
  tin: z.string().min(3),
  companyEmail: z.string().email(),
  branchAddress: z.string().min(3),
  headOfficeAddress: z.string().min(3),
  city: z.string().min(2),
  lga: z.string().min(2),
  state: z.string().min(2),
  classification: z.string().min(2),
  shareCapital: z.string().min(1)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const refreshCookieBaseOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production"
};

const refreshCookieOptions = {
  ...refreshCookieBaseOptions,
  maxAge: 7 * 24 * 60 * 60 * 1000
};

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function normalizeGender(value: unknown): string {
  const raw = String(value ?? "male").toLowerCase();
  return raw.includes("female") ? "female" : "male";
}

function extractString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function pollCircleTransaction(txId: string): Promise<{ txHash: string }> {
  const maxAttempts = 30;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tx = await circleClient.getTransaction(txId);
    const state = tx.state.toUpperCase();

    if (state === "CONFIRMED" || state === "COMPLETE") {
      return { txHash: tx.txHash ?? "" };
    }

    if (state === "FAILED" || state === "REJECTED" || state === "CANCELLED" || state === "DENIED") {
      const detail = [tx.errorReason, tx.errorDetails].filter(Boolean).join(": ");
      logger.error({ txId, state, errorReason: tx.errorReason, errorDetails: tx.errorDetails }, "On-chain registration transaction failed");
      throw new ApiError(502, `On-chain registration failed (${state})${detail ? `: ${detail}` : ""}`);
    }

    await sleep(2000);
  }

  throw new ApiError(504, "On-chain registration timed out");
}

async function issueAuthResponse(
  res: Response,
  user: { id: string; email: string; role: "USER" | "ADMIN" | "SUPER_ADMIN"; profileType: "INDIVIDUAL" | "BUSINESS" }
): Promise<void> {
  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    profileType: user.profileType
  };

  const accessToken = await tokenService.signAccessToken(claims);
  const refreshToken = await tokenService.signRefreshToken(claims);

  res.cookie("refreshToken", refreshToken, {
    ...refreshCookieOptions
  });

  res.status(201).json({
    success: true,
    redirectTo: "/dashboard",
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      profileType: user.profileType
    }
  });
}

authRouter.post(
  "/send-otp",
  memoryRateLimit("send-otp", 5, 60 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { email } = sendOtpSchema.parse(req.body);
    const result = await otpService.sendOtp(email);
    res.status(202).json({ message: "OTP sent", ...result });
  })
);

authRouter.post(
  "/verify-otp",
  memoryRateLimit("verify-otp", 10, 60 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { email, otp } = verifyOtpSchema.parse(req.body);
    await otpService.verifyOtp(email, otp);
    const session = await registrationSessionService.create(email);
    res.status(200).json({ registrationSessionToken: session.token, expiresAt: session.expiresAt.toISOString() });
  })
);

authRouter.post(
  "/register/individual",
  asyncHandler(async (req, res) => {
    let createdUser: CreatedAuthUser | null = null;
    let session: { id: string } | null = null;
    
    try {
      // Parse payload first (validation outside transaction)
      const payload = individualRegisterSchema.parse(req.body);

      // Validate session
      session = await registrationSessionService.assertValid(payload.registrationSessionToken, payload.email);

      // Check existing user (quick check before transaction)
      const [existingUser] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1);
      if (existingUser) {
        throw new ApiError(409, "Email already exists");
      }

      await tinService.assertAvailableForRegistration("INDIVIDUAL", payload.tin, payload.email);

      // Verify NIN with VerifyMe (external API call outside transaction)
      const identity = await verifyMeClient.verifyNin(payload.nin);
      
      const firstname = extractString(identity, "firstname", "firstName");
      const lastname = extractString(identity, "lastname", "lastName");

      if (!firstname || !lastname) {
        throw new ApiError(400, "VerifyMe did not return required NIN profile data");
      }

      // Hash password and NIN
      const passwordHash = await bcrypt.hash(payload.password, 10);
      const ninHash = sha256(payload.nin);

      // START TRANSACTION - All database operations in one atomic transaction
      const result = await db.transaction(async (tx) => {
        try {
          // 1. Create user
          const [user] = await tx
            .insert(users)
            .values({
              email: payload.email,
              passwordHash,
              profileType: "INDIVIDUAL",
              role: "USER",
              status: "PENDING"
            })
            .returning();
          
          // 2. Create individual profile
          await tx.insert(individualProfiles).values({
            userId: user.id,
            tin: payload.tin,
            ninHash,
            firstname,
            lastname,
            middlename: extractString(identity, "middlename", "middleName"),
            dob: extractString(identity, "birthdate", "dob"),
            gender: normalizeGender(identity.gender),
            phone: extractString(identity, "phone"),
            photoUrl: extractString(identity, "photo")
          });

          return user;
        } catch (error) {
          throw error; // This will trigger the rollback
        }
      });
      
      createdUser = result;

      // After successful database transaction, proceed with external services
      // If these fail, we need to clean up the created user
      try {
        // 3. Create Circle wallet
        let wallet;
        try {
          wallet = await circleClient.createScaWallet();
        } catch (circleError) {
          const message = circleError instanceof Error ? circleError.message : "Unknown Circle error";
          throw new ApiError(500, `Failed to create wallet: ${message}`);
        }

        // 4. Update user with wallet info (separate transaction)
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ walletAddress: wallet.address, circleWalletId: wallet.walletId })
            .where(eq(users.id, createdUser!.id));
        });

        // 5. Execute contract
        const adminWalletId = env.CIRCLE_ADMIN_WALLET_ID ?? wallet.walletId;

        const registrationTx = await circleClient.executeContract({
          walletId: adminWalletId,
          abiFunctionSignature: circleExecutionMap.userRegistration,
          abiParameters: [
            wallet.address,
            payload.tin,
            payload.nin,
            "NIN",
            payload.email,
            firstname,
            lastname,
            extractString(identity, "middlename", "middleName"),
            extractString(identity, "birthdate", "dob"),
            normalizeGender(identity.gender)
          ]
        });

        // 6. Poll for transaction completion
        const polled = await pollCircleTransaction(registrationTx.transactionId);

        // 7. Update user with on-chain info (separate transaction)
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              status: "ACTIVE",
              onChainRegistered: true,
              onChainTxHash: polled.txHash || registrationTx.transactionId
            })
            .where(eq(users.id, createdUser!.id));
        });

        // 8. Consume session
        await registrationSessionService.consume(session!.id);
        tinService.release(payload.tin, payload.email);

        // 9. Issue auth response
        await issueAuthResponse(res, {
          id: createdUser!.id,
          email: createdUser!.email,
          role: "USER",
          profileType: "INDIVIDUAL"
        });

      } catch (error) {
        // If external services fail, we need to clean up the created user
        // Delete the user and all related data in a transaction
        await db.transaction(async (tx) => {
          // Delete profile first (due to foreign key)
          if (!createdUser) {
            return;
          }
          await tx.delete(individualProfiles).where(eq(individualProfiles.userId, createdUser.id));
          // Then delete user
          await tx.delete(users).where(eq(users.id, createdUser.id));
        });

        throw error; // Re-throw the original error
      }
      
    } catch (error) {
      // If we have a session but registration failed, don't consume it
      // The session will expire naturally
      
      // Send appropriate error response
      if (error instanceof ApiError) {
        res.status(error.statusCode).json({ message: error.message });
      } else if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid input data", issues: error.issues });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  })
);

authRouter.post(
  "/register/business/submit",
  asyncHandler(async (req, res) => {
    const payload = businessSubmitSchema.parse(req.body);
    await registrationSessionService.assertValid(payload.registrationSessionToken, payload.email);

    const verifyMeResult = await verifyMeClient.submitBusinessVerification({
      rcNumber: payload.rcNumber,
      applicant: payload.applicant
    });

    const [job] = await db
      .insert(businessVerificationJobs)
      .values({
        rcNumber: payload.rcNumber,
        verifymeVerificationId: verifyMeResult.verificationId,
        verifymeReference: verifyMeResult.reference,
        status: "PENDING",
        resultData: verifyMeResult.raw
      })
      .returning();

    res.status(202).json({ jobId: job.id, status: "PENDING" });
  })
);

authRouter.get(
  "/register/business/status/:jobId",
  asyncHandler(async (req, res) => {
    const jobId = String(req.params.jobId);
    const [job] = await db.select().from(businessVerificationJobs).where(eq(businessVerificationJobs.id, jobId)).limit(1);

    if (!job) {
      throw new ApiError(404, "Verification job not found");
    }

    const result = await verifyMeClient.getBusinessVerification(job.verifymeVerificationId);

    if (result.status === "COMPLETED") {
      await db
        .update(businessVerificationJobs)
        .set({ status: "COMPLETED", resultData: result.raw, completedAt: new Date() })
        .where(eq(businessVerificationJobs.id, job.id));
    } else if (result.status === "FAILED") {
      await db
        .update(businessVerificationJobs)
        .set({ status: "FAILED", resultData: result.raw, errorMessage: "VerifyMe business verification failed" })
        .where(eq(businessVerificationJobs.id, job.id));
    }

    const payload = result.raw as Record<string, unknown>;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const business = (data.business ?? data) as Record<string, unknown>;
    const applicant = (data.applicant ?? {}) as Record<string, unknown>;

    res.status(200).json({
      jobId: job.id,
      status: result.status,
      verifiedPreview:
        result.status === "COMPLETED"
          ? {
              companyName: extractString(business, "name", "businessNameFound"),
              rcNumber: extractString(business, "rcNumber"),
              companyType: extractString(business, "type"),
              // Address fields live on the top-level verification data.
              street: extractString(data, "street", "address"),
              city: extractString(data, "city"),
              lga: extractString(data, "lga"),
              state: extractString(data, "state"),
              country: extractString(data, "country"),
              applicantFirstname: extractString(applicant, "firstname"),
              applicantLastname: extractString(applicant, "lastname"),
              applicantPhone: extractString(applicant, "phone")
            }
          : undefined
    });
  })
);

authRouter.post(
  "/register/business/complete",
  asyncHandler(async (req, res) => {
    const payload = businessCompleteSchema.parse(req.body);
    const session = await registrationSessionService.assertValid(payload.registrationSessionToken, payload.email);

    const [existingUser] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1);
    if (existingUser) {
      throw new ApiError(409, "Email already exists");
    }

    await tinService.assertAvailableForRegistration("BUSINESS", payload.tin, payload.email);

    const [job] = await db
      .select()
      .from(businessVerificationJobs)
      .where(and(eq(businessVerificationJobs.id, payload.jobId), eq(businessVerificationJobs.status, "COMPLETED")))
      .limit(1);

    if (!job || !job.resultData) {
      throw new ApiError(400, "Business verification job is not completed");
    }

    const raw = job.resultData as Record<string, unknown>;
    const data = (raw.data ?? raw) as Record<string, unknown>;
    const business = (data.business ?? data) as Record<string, unknown>;

    const rcNumber = extractString(business, "rcNumber") || job.rcNumber;
    const companyName = extractString(business, "name", "businessNameFound");
    const companyType = extractString(business, "type") || "Formal";

    if (!companyName) {
      throw new ApiError(400, "VerifyMe business details missing company name");
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const created = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          email: payload.email,
          passwordHash,
          profileType: "BUSINESS",
          role: "USER",
          status: "PENDING"
        })
        .returning();

      await tx.insert(businessProfiles).values({
        userId: createdUser.id,
        tin: payload.tin,
        rcNumber,
        verifymeVerificationId: job.verifymeVerificationId,
        verifymeReference: job.verifymeReference ?? undefined,
        companyName,
        companyType,
        companyEmail: payload.companyEmail,
        branchAddress: payload.branchAddress,
        headOfficeAddress: payload.headOfficeAddress,
        city: payload.city,
        lga: payload.lga,
        state: payload.state,
        classification: payload.classification,
        shareCapital: payload.shareCapital,
        isActive: true
      });

      return createdUser;
    });

    try {
      const wallet = await circleClient.createScaWallet();
      await db
        .update(users)
        .set({ walletAddress: wallet.address, circleWalletId: wallet.walletId })
        .where(eq(users.id, created.id));

      const adminWalletId = env.CIRCLE_ADMIN_WALLET_ID ?? wallet.walletId;

      const registrationTx = await circleClient.executeContract({
        walletId: adminWalletId,
        abiFunctionSignature: circleExecutionMap.businessRegistration,
        abiParameters: [
          wallet.address,
          payload.tin,
          rcNumber,
          companyName,
          companyType,
          new Date().toISOString().slice(0, 10),
          payload.branchAddress,
          payload.companyEmail,
          payload.city,
          payload.classification,
          payload.headOfficeAddress,
          payload.lga,
          "",
          payload.shareCapital,
          "",
          payload.state,
          true
        ]
      });

      const polled = await pollCircleTransaction(registrationTx.transactionId);

      await db
        .update(users)
        .set({
          status: "ACTIVE",
          onChainRegistered: true,
          onChainTxHash: polled.txHash || registrationTx.transactionId
        })
        .where(eq(users.id, created.id));

      await registrationSessionService.consume(session.id);
      tinService.release(payload.tin, payload.email);

      await issueAuthResponse(res, {
        id: created.id,
        email: created.email,
        role: "USER",
        profileType: "BUSINESS"
      });
    } catch (error) {
      await db.transaction(async (tx) => {
        await tx.delete(businessProfiles).where(eq(businessProfiles.userId, created.id));
        await tx.delete(users).where(eq(users.id, created.id));
      });

      throw error;
    }
  })
);

authRouter.get("/verify-email/:token", (req, res) => {
  res.status(200).json({ token: req.params.token, verified: true });
});

// authRouter.post(
//  "/login",
//   asyncHandler(async (req, res) => {
//     const { email, password } = loginSchema.parse(req.body);

//     const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
//     console.log("USER", user)
//     if (!user || !user.passwordHash) {
//       throw new ApiError(401, "Invalid email or password");
//     }

//     const isValid = await bcrypt.compare(password, user.passwordHash);
//     if (!isValid) {
//       throw new ApiError(401, "Invalid email or password");
//     }

//     const accessToken = await tokenService.signAccessToken({
//       sub: user.id,
//       email: user.email,
//       role: user.role,
//       profileType: user.profileType ?? undefined
//     });

//     const refreshToken = await tokenService.signRefreshToken({
//       sub: user.id,
//       email: user.email,
//       role: user.role,
//       profileType: user.profileType ?? undefined
//     });

//     res.cookie("refreshToken", refreshToken, {
//       ...refreshCookieOptions
//     });

//     res.status(200).json({
//       accessToken,
//       user: {
//         id: user.id,
//         email: user.email,
//         role: user.role,
//         profileType: user.profileType
//       }
//     });
//   })
// );
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    console.log("LOGIN: request received");

    const { email, password } = loginSchema.parse(req.body);

    console.log("LOGIN: validation passed", { email });

console.log("LOGIN: before database query");

let user;

try {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  console.log("LOGIN: database query succeeded");
  console.log("LOGIN: result:", result);

  user = result[0];
} catch (error) {
  console.error("=================================");
  console.error("DATABASE QUERY FAILED");
  console.error("=================================");
  console.error(error);

  if (error instanceof Error) {
    console.error("MESSAGE:", error.message);
    console.error("STACK:", error.stack);
  }

  throw error;
}

console.log("LOGIN: user:", user);
    console.log("LOGIN: user query completed", {
      found: !!user,
      userId: user?.id,
      hasPasswordHash: !!user?.passwordHash,
    });

    if (!user || !user.passwordHash) {
      throw new ApiError(401, "Invalid email or password");
    }

    console.log("LOGIN: comparing password");

    const isValid = await bcrypt.compare(password, user.passwordHash);

    console.log("LOGIN: password comparison completed", {
      isValid,
    });

    if (!isValid) {
      throw new ApiError(401, "Invalid email or password");
    }

    console.log("LOGIN: signing access token");

    const accessToken = await tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      profileType: user.profileType ?? undefined,
    });

    console.log("LOGIN: access token created");

    console.log("LOGIN: signing refresh token");

    const refreshToken = await tokenService.signRefreshToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      profileType: user.profileType ?? undefined,
    });

    console.log("LOGIN: refresh token created");

    res.cookie("refreshToken", refreshToken, {
      ...refreshCookieOptions,
    });

    console.log("LOGIN: response being sent");

    res.status(200).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profileType: user.profileType,
      },
    });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (user.profileType === "BUSINESS") {
      const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, userId)).limit(1);
      res.json({
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
        state: profile?.state
      });
    } else {
      const [profile] = await db.select().from(individualProfiles).where(eq(individualProfiles.userId, userId)).limit(1);
      res.json({
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
        photoUrl: profile?.photoUrl
      });
    }
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken as string | undefined;
    if (!refreshToken) {
      throw new ApiError(401, "Refresh token missing");
    }

    const claims = await tokenService.verifyRefreshToken(refreshToken);
    const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }

    const nextClaims = {
      sub: user.id,
      email: user.email,
      role: user.role,
      profileType: user.profileType ?? undefined
    };
    const accessToken = await tokenService.signAccessToken(nextClaims);
    const nextRefreshToken = await tokenService.signRefreshToken(nextClaims);

    res.cookie("refreshToken", nextRefreshToken, {
      ...refreshCookieOptions
    });

    res.status(200).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profileType: user.profileType
      }
    });
  })
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("refreshToken", refreshCookieBaseOptions);
  res.status(204).send();
});

authRouter.post("/forgot-password", (_req, res) => {
  res.status(202).json({ message: "Reset email queued" });
});

authRouter.post("/reset-password", (_req, res) => {
  res.status(200).json({ message: "Password reset scaffolded" });
});
