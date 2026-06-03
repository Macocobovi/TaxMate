import "dotenv/config";
import { constants, createPublicKey, publicEncrypt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

type JsonRecord = Record<string, unknown>;

function ensureHexSecret(secret: string): string {
  const normalized = secret.startsWith("0x") ? secret.slice(2) : secret;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("CIRCLE_ENTITY_SECRET must be 32-byte hex (64 chars, optional 0x prefix)");
  }
  return normalized;
}

function normalizePemPublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.startsWith("-----BEGIN PUBLIC KEY-----")) {
    return trimmed;
  }

  const chunked = trimmed.match(/.{1,64}/g)?.join("\n") ?? trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${chunked}\n-----END PUBLIC KEY-----`;
}

function createFreshCiphertext(entitySecretHex: string, publicKeyPem: string): string {
  const encrypted = publicEncrypt(
    {
      key: createPublicKey(publicKeyPem),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(entitySecretHex, "hex")
  );
  return encrypted.toString("base64");
}

async function requestJson(
  url: string,
  apiKey: string,
  method: "GET" | "POST",
  body?: JsonRecord
): Promise<{ ok: boolean; status: number; payload: JsonRecord }> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  return { ok: response.ok, status: response.status, payload };
}

async function getEntityPublicKey(baseUrl: string, apiKey: string): Promise<string> {
  const response = await requestJson(`${baseUrl}/v1/w3s/config/entity/publicKey`, apiKey, "GET");
  if (!response.ok) {
    throw new Error(`Unable to fetch entity public key (${response.status}): ${JSON.stringify(response.payload)}`);
  }

  const data = (response.payload.data ?? response.payload) as JsonRecord;
  const publicKey = String(data.publicKey ?? "");

  if (!publicKey) {
    throw new Error(`Entity public key missing in response: ${JSON.stringify(response.payload)}`);
  }

  return normalizePemPublicKey(publicKey);
}

function extractWalletSetId(payload: JsonRecord): string {
  const data = (payload.data ?? payload) as JsonRecord;
  const walletSet = (data.walletSet ?? data) as JsonRecord;

  const walletSetId =
    (typeof walletSet.id === "string" && walletSet.id) ||
    (typeof data.walletSetId === "string" && data.walletSetId) ||
    "";

  if (!walletSetId) {
    throw new Error(`Unable to parse wallet set id from response: ${JSON.stringify(payload)}`);
  }

  return walletSetId;
}

function extractWalletId(payload: JsonRecord): string {
  const data = (payload.data ?? payload) as JsonRecord;
  const wallets = (data.wallets ?? []) as JsonRecord[];
  const wallet = wallets[0] ?? ((data.wallet as JsonRecord | undefined) ?? {});

  const walletId =
    (typeof wallet.id === "string" && wallet.id) ||
    (typeof data.walletId === "string" && data.walletId) ||
    "";

  if (!walletId) {
    throw new Error(`Unable to parse admin wallet id from response: ${JSON.stringify(payload)}`);
  }

  return walletId;
}

async function createWalletSet(
  baseUrl: string,
  apiKey: string,
  entitySecretCiphertext: string,
  walletSetName: string
): Promise<string> {
  const developerUrl = `${baseUrl}/v1/w3s/developer/walletSets`;

  const response = await requestJson(developerUrl, apiKey, "POST", {
    idempotencyKey: randomUUID(),
    name: walletSetName,
    entitySecretCiphertext
  });

  if (!response.ok) {
    throw new Error(`Failed to create wallet set (${response.status}): ${JSON.stringify(response.payload)}`);
  }

  return extractWalletSetId(response.payload);
}

async function createAdminWallet(
  baseUrl: string,
  apiKey: string,
  entitySecretCiphertext: string,
  walletSetId: string,
  blockchain: string,
  accountType: string
): Promise<string> {
  const requestBody: JsonRecord = {
    idempotencyKey: randomUUID(),
    walletSetId,
    blockchains: [blockchain],
    entitySecretCiphertext,
    accountType,
    count: 1
  };

  const primary = await requestJson(`${baseUrl}/v1/w3s/wallets`, apiKey, "POST", requestBody);
  if (primary.ok) {
    return extractWalletId(primary.payload);
  }

  const fallback = await requestJson(`${baseUrl}/v1/w3s/developer/wallets`, apiKey, "POST", requestBody);
  if (fallback.ok) {
    return extractWalletId(fallback.payload);
  }

  throw new Error(
    `Failed to create admin wallet. Primary (${primary.status}): ${JSON.stringify(primary.payload)} | Fallback (${fallback.status}): ${JSON.stringify(fallback.payload)}`
  );
}

async function main(): Promise<void> {
  const apiKey = assertEnv("CIRCLE_API_KEY");
  const entitySecret = ensureHexSecret(assertEnv("CIRCLE_ENTITY_SECRET"));
  const baseUrl = (process.env.CIRCLE_API_BASE_URL?.trim() || "https://api.circle.com").replace(/\/+$/, "");

  const walletSetName = process.env.CIRCLE_WALLET_SET_NAME?.trim() || `taxmate-wallet-set-${Date.now()}`;
  const adminBlockchain = process.env.CIRCLE_ADMIN_WALLET_BLOCKCHAIN?.trim() || "BASE-SEPOLIA";
  const adminAccountType = process.env.CIRCLE_ADMIN_WALLET_ACCOUNT_TYPE?.trim() || "SCA";

  const publicKey = await getEntityPublicKey(baseUrl, apiKey);

  let walletSetId: string;
  try {
    // Fresh ciphertext per request avoids Circle 156004 reuse errors.
    walletSetId = await createWalletSet(baseUrl, apiKey, createFreshCiphertext(entitySecret, publicKey), walletSetName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("\"code\":156016") || message.toLowerCase().includes("entity secret has not been set")) {
      throw new Error(
        "Circle entity secret is not registered yet. In Circle Console, open Web3 Services > Developer-Controlled Wallets > Entity Secret and register your ciphertext, then rerun this script."
      );
    }
    throw error;
  }

  const adminWalletId = await createAdminWallet(
    baseUrl,
    apiKey,
    createFreshCiphertext(entitySecret, publicKey),
    walletSetId,
    adminBlockchain,
    adminAccountType
  );

  mkdirSync(resolve("backend/.circle"), { recursive: true });
  const outputPath = resolve("backend/.circle/wallet-bootstrap.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apiBaseUrl: baseUrl,
        walletSetName,
        adminBlockchain,
        adminAccountType,
        walletSetId,
        adminWalletId
      },
      null,
      2
    )
  );

  console.log("----------------------------------------");
  console.log("Circle wallet bootstrap complete");
  console.log("Snapshot:", outputPath);
  console.log("Copy into your secret manager:");
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log(`CIRCLE_ADMIN_WALLET_ID=${adminWalletId}`);
  console.log("----------------------------------------");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Failed to bootstrap Circle wallet set/admin wallet:", message);
  process.exit(1);
});
