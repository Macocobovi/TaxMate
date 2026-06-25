import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

// Pinata v3 files API: https://docs.pinata.cloud/api-reference/endpoint/upload-a-file
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

export class PinataClient {
  private stub(name: string): { cid: string; url: string } {
    const cid = `stub-${name}`;
    return { cid, url: `${env.PINATA_GATEWAY_URL}/${cid}` };
  }

  async pinReceipt(buffer: Buffer, name: string): Promise<{ cid: string; url: string }> {
    // No JWT configured: keep local/dev usable with a deterministic stub CID.
    if (!env.PINATA_JWT) {
      logger.warn({ name }, "PINATA_JWT not set; skipping IPFS pin (stub CID)");
      return this.stub(name);
    }

    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/json" }), `${name}.json`);
      form.append("network", "public");
      form.append("name", `taxmate-receipt-${name}`);

      const response = await fetch(PINATA_UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
        body: form
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pinata responded ${response.status}: ${body}`);
      }

      const json = (await response.json()) as { data?: { cid?: string } };
      const cid = json.data?.cid;
      if (!cid) {
        throw new Error("Pinata returned no CID");
      }

      logger.info({ cid, name }, "Receipt pinned to IPFS");
      return { cid, url: `${env.PINATA_GATEWAY_URL}/${cid}` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // In production a missing receipt is a hard failure; in dev fall back to a
      // stub CID so a misconfigured/disabled Pinata account doesn't block testing.
      if (env.NODE_ENV === "production") {
        logger.error({ name, detail }, "Pinata pin failed");
        throw new Error("Could not store the receipt on IPFS. Please try again later.");
      }
      logger.warn({ name, detail }, "Pinata pin failed; using stub CID (dev fallback)");
      return this.stub(name);
    }
  }
}

export const pinataClient = new PinataClient();
