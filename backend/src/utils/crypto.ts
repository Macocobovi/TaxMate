import crypto from "node:crypto";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateOtp(): string {
  return `${crypto.randomInt(100000, 1000000)}`;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
