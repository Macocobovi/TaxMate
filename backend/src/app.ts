import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./modules/health/router.js";
import { authRouter } from "./modules/auth/router.js";
import { identityRouter } from "./modules/identity/router.js";
import { userRouter } from "./modules/user/router.js";
import { taxItemsRouter } from "./modules/tax-items/router.js";
import { paymentsRouter } from "./modules/payments/router.js";
import { adminRouter } from "./modules/admin/router.js";

export const app = express();

// Allowed CORS origins: NEXT_PUBLIC_APP_URL plus any in CORS_ALLOWED_ORIGINS
// (comma-separated). Trailing slashes are stripped so config like
// "https://app.example.com/" still matches the origin "https://app.example.com".
const normalizeOrigin = (value: string): string =>
  value.trim().replace(/\/+$/, "");

const allowedOrigins = new Set(
  [
    env.NEXT_PUBLIC_APP_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS?.split(",") ?? []),
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

console.log("ORIGINS", process.env.CORS_ALLOWED_ORIGINS)
// Optionally allow Vercel preview deployments (*.vercel.app). Convenient for
// // staging; leave off in production to avoid allowing arbitrary Vercel apps.
// const allowVercelPreviews = process.env.CORS_ALLOW_VERCEL_PREVIEWS === "true";

app.use(helmet());

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      const normalized = normalizeOrigin(origin);

      if (allowedOrigins.has(normalized)) {
        return callback(null, true);
      }

      logger.warn({ origin }, "Blocked CORS origin");
      return callback(null, false);
    },
  })
);

app.use(cookieParser());
app.use(
  express.json({
    // Keep the raw bytes so webhook signatures can be verified against the
    // exact payload (re-stringifying the parsed JSON would not match).
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    }
  })
);
app.use(pinoHttp({ logger }));

app.use(`${env.API_PREFIX}/health`, healthRouter);
app.use(`${env.API_PREFIX}/auth`, authRouter);
app.use(`${env.API_PREFIX}/identity`, identityRouter);
app.use(`${env.API_PREFIX}/user`, requireAuth, userRouter);
app.use(`${env.API_PREFIX}/tax-items`, requireAuth, taxItemsRouter);
app.use(`${env.API_PREFIX}/payments`, paymentsRouter);
app.use(`${env.API_PREFIX}/admin`, requireAuth, adminRouter);

app.use(errorHandler);
