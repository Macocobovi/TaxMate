import "dotenv/config";

type JsonRecord = Record<string, unknown>;

type Attempt = {
  method: "POST" | "PUT";
  path: string;
  body: JsonRecord;
};

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function requestJson(
  baseUrl: string,
  apiKey: string,
  attempt: Attempt
): Promise<{ ok: boolean; status: number; payload: JsonRecord }> {
  const response = await fetch(`${baseUrl}${attempt.path}`, {
    method: attempt.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(attempt.body)
  });

  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  return { ok: response.ok, status: response.status, payload };
}

async function main(): Promise<void> {
  const apiKey = assertEnv("CIRCLE_API_KEY");
  const entitySecretCiphertext = assertEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT");
  const baseUrl = (process.env.CIRCLE_API_BASE_URL?.trim() || "https://api.circle.com").replace(/\/+$/, "");

  const attempts: Attempt[] = [
    {
      method: "POST",
      path: "/v1/w3s/config/entity/register",
      body: { entitySecretCiphertext }
    },
    {
      method: "PUT",
      path: "/v1/w3s/config/entity",
      body: { entitySecretCiphertext }
    },
    {
      method: "POST",
      path: "/v1/w3s/config/entity",
      body: { entitySecretCiphertext }
    }
  ];

  const diagnostics: Array<{ method: string; path: string; status: number; payload: JsonRecord }> = [];

  for (const attempt of attempts) {
    const response = await requestJson(baseUrl, apiKey, attempt);

    diagnostics.push({
      method: attempt.method,
      path: attempt.path,
      status: response.status,
      payload: response.payload
    });

    if (response.ok) {
      console.log("----------------------------------------");
      console.log("Entity secret ciphertext registered successfully");
      console.log("Endpoint:", `${attempt.method} ${attempt.path}`);
      console.log("Response:", JSON.stringify(response.payload, null, 2));
      console.log("----------------------------------------");
      return;
    }
  }

  const serialized = JSON.stringify(diagnostics, null, 2);

  throw new Error(
    [
      "Unable to register ciphertext through public API endpoints for this account/environment.",
      "Circle may require registering ciphertext in Console for your current project.",
      "Console path: Web3 Services -> Developer-Controlled Wallets -> Entity Secret",
      "Attempt diagnostics:",
      serialized
    ].join("\n")
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
