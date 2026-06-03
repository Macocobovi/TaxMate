import { env } from "../config/env.js";

export class PinataClient {
  async pinReceipt(_buffer: Buffer, name: string): Promise<{ cid: string; url: string }> {
    const cid = `stub-${name}`;
    return {
      cid,
      url: `${env.PINATA_GATEWAY_URL}/${cid}`
    };
  }
}

export const pinataClient = new PinataClient();
