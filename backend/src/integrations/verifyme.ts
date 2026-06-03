import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

type VerifyMeBusinessSubmitPayload = {
  rcNumber: string;
  applicant: {
    idType: string;
    idNumber: string;
    firstname: string;
    lastname: string;
  };
};

type VerifyMeBusinessSubmitResult = {
  verificationId: string;
  reference?: string;
  raw: unknown;
};

type VerifyMeBusinessStatusResult = {
  status: "PENDING" | "COMPLETED" | "FAILED";
  raw: unknown;
};

type VerifyMeMockData = {
  individualByNin: Record<string, Record<string, unknown>>;
  businessByRc: Record<string, Record<string, unknown>>;
};

const mockData = JSON.parse(
  readFileSync(new URL("../mocks/verifyme-mocks.json", import.meta.url), "utf-8")
) as VerifyMeMockData;

const mockBusinessVerificationMap = new Map<string, string>();

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function useMockMode(): boolean {
  return !env.VERIFYME_API_KEY;
}

function getRequiredApiKey(): string {
  if (!env.VERIFYME_API_KEY) {
    throw new ApiError(500, "VERIFYME_API_KEY is not configured");
  }
  return env.VERIFYME_API_KEY;
}

export class VerifyMeClient {
  private readonly baseUrl = env.VERIFYME_BASE_URL;

  async verifyNin(nin: string): Promise<Record<string, unknown>> {
    if (useMockMode()) {
      const record = mockData.individualByNin[nin];
      if (!record) {
        throw new ApiError(404, `No mocked NIN record for ${nin}`);
      }
      return deepClone(record.data as Record<string, unknown>);
    }

    const apiKey = getRequiredApiKey();
    const response = await fetch(`${this.baseUrl}/v1/verifications/identities/nin/${nin}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiError(400, `VerifyMe NIN verification failed: ${JSON.stringify(body)}`);
    }

    const data = (body.data ?? body) as Record<string, unknown>;
    return data;
  }

  async submitBusinessVerification(payload: VerifyMeBusinessSubmitPayload): Promise<VerifyMeBusinessSubmitResult> {
    if (useMockMode()) {
      const record = mockData.businessByRc[payload.rcNumber];
      if (!record) {
        throw new ApiError(404, `No mocked business record for RC ${payload.rcNumber}`);
      }

      const data = deepClone((record.data ?? {}) as Record<string, unknown>);
      const verificationId = `mock-vm-${payload.rcNumber}-${randomUUID().slice(0, 8)}`;
      mockBusinessVerificationMap.set(verificationId, payload.rcNumber);

      data.id = verificationId;

      return {
        verificationId,
        reference: typeof data.reference === "string" ? data.reference : "VMN_mock_reference",
        raw: {
          status: "success",
          data
        }
      };
    }

    const apiKey = getRequiredApiKey();
    const response = await fetch(`${this.baseUrl}/v1/verifications/businesses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiError(400, `VerifyMe business submit failed: ${JSON.stringify(body)}`);
    }

    const data = (body.data ?? body) as Record<string, unknown>;
    const verificationId = String(data.id ?? "");

    if (!verificationId) {
      throw new ApiError(502, "VerifyMe business submit response missing verification id");
    }

    return {
      verificationId,
      reference: data.reference ? String(data.reference) : undefined,
      raw: body
    };
  }

  async getBusinessVerification(verificationId: string): Promise<VerifyMeBusinessStatusResult> {
    if (useMockMode()) {
      const rcNumber = mockBusinessVerificationMap.get(verificationId) ?? verificationId.replace(/^mock-vm-/, "").split("-")[0];
      const record = mockData.businessByRc[rcNumber];

      if (!record) {
        throw new ApiError(404, `No mocked business status record for verification ${verificationId}`);
      }

      const data = deepClone((record.data ?? {}) as Record<string, unknown>);
      const statusContainer = (data.status ?? {}) as Record<string, unknown>;
      statusContainer.status = "Completed";
      statusContainer.subStatus = "Completed";
      statusContainer.state = "Completed";
      data.status = statusContainer;
      data.id = verificationId;
      data.completedAt = new Date().toISOString();

      return {
        status: "COMPLETED",
        raw: {
          status: "success",
          data
        }
      };
    }

    const apiKey = getRequiredApiKey();
    const response = await fetch(`${this.baseUrl}/v1/verifications/businesses/${verificationId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiError(400, `VerifyMe business status failed: ${JSON.stringify(body)}`);
    }

    const data = (body.data ?? body) as Record<string, unknown>;
    const statusContainer = (data.status ?? {}) as Record<string, unknown>;
    const rawStatus = String(statusContainer.status ?? data.status ?? "").toLowerCase();

    if (rawStatus.includes("complete")) {
      return { status: "COMPLETED", raw: body };
    }

    if (rawStatus.includes("fail") || rawStatus.includes("declin") || rawStatus.includes("reject")) {
      return { status: "FAILED", raw: body };
    }

    return { status: "PENDING", raw: body };
  }
}

export const verifyMeClient = new VerifyMeClient();
