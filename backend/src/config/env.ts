import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  VERIFYME_API_KEY: z.string().optional(),
  VERIFYME_BASE_URL: z.string().url().default("https://vapi.verifyme.ng"),
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  MONNIFY_BASE_URL: z.string().url().default("https://api.monnify.com"),
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_ENTITY_SECRET_CIPHERTEXT: z.string().optional(),
  CIRCLE_WALLET_SET_ID: z.string().optional(),
  CIRCLE_ADMIN_WALLET_ID: z.string().optional(),
  CIRCLE_BASE_URL: z.string().url().default("https://api.circle.com"),
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY_URL: z.string().url().default("https://gateway.pinata.cloud/ipfs"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default("noreply@taxmate.ng"),
  TAXMATE_CONTRACT_ADDRESS: z.string().optional(),
  BASE_RPC_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);
