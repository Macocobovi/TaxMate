import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { constants, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function ensureHexSecret(secret: string): string {
  const normalized = secret.startsWith("0x") ? secret.slice(2) : secret;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("CIRCLE_ENTITY_SECRET must be a 32-byte hex value (64 hex chars, with or without 0x)");
  }
  return normalized;
}

function normalizePemPublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.startsWith("-----BEGIN PUBLIC KEY-----")) {
    return trimmed;
  }

  // Fallback in case API returns raw base64 key body.
  const chunked = trimmed.match(/.{1,64}/g)?.join("\n") ?? trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${chunked}\n-----END PUBLIC KEY-----`;
}

function createEntitySecretCiphertext(entitySecretHex: string, publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(entitySecretHex, "hex")
  );
  return encrypted.toString("base64");
}

async function main(): Promise<void> {
  const apiKey = assertEnv("CIRCLE_API_KEY");
  const circleApiBaseUrl = (process.env.CIRCLE_API_BASE_URL?.trim() || "https://api.circle.com").replace(/\/+$/, "");
  const entitySecretFromEnv = process.env.CIRCLE_ENTITY_SECRET?.trim();
  const entitySecret = entitySecretFromEnv
    ? ensureHexSecret(entitySecretFromEnv)
    : randomBytes(32).toString("hex");

  const publicKeyResponse = await fetch(`${circleApiBaseUrl}/v1/w3s/config/entity/publicKey`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  const publicKeyPayload = (await publicKeyResponse.json()) as Record<string, unknown>;
  if (!publicKeyResponse.ok) {
    throw new Error(`Failed to fetch Circle public key: ${JSON.stringify(publicKeyPayload)}`);
  }

  const publicKeyData = (publicKeyPayload.data ?? publicKeyPayload) as Record<string, unknown>;
  const rawPublicKey = String(publicKeyData.publicKey ?? "");
  if (!rawPublicKey) {
    throw new Error("Circle public key response missing data.publicKey");
  }

  const normalizedPublicKey = normalizePemPublicKey(rawPublicKey);
  const entitySecretCiphertext = createEntitySecretCiphertext(entitySecret, normalizedPublicKey);

  const recoveryPath = resolve(
    process.env.CIRCLE_RECOVERY_FILE_PATH?.trim() || "backend/.circle/recovery-file.json"
  );

  mkdirSync(dirname(recoveryPath), { recursive: true });
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        entitySecret,
        publicKey: normalizedPublicKey
      },
      null,
      2
    )
  );

  // Keep a local machine-readable snapshot for easy copy into env management.
  const outputPath = resolve("backend/.circle/entity-secret-registration.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apiBaseUrl: circleApiBaseUrl,
        entitySecret,
        entitySecretCiphertext,
        publicKey: normalizedPublicKey
      },
      null,
      2
    )
  );

  console.log("----------------------------------------");
  console.log("Circle entity secret registration complete");
  console.log("Recovery file:", recoveryPath);
  console.log("Registration snapshot:", outputPath);
  console.log("Copy these into your secret manager:");
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log(`CIRCLE_ENTITY_SECRET_CIPHERTEXT=${entitySecretCiphertext}`);
  console.log("----------------------------------------");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Failed to register Circle entity secret:", message);
  process.exit(1);
});
