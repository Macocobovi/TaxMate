export class ResendClient {
  async sendEmail(payload: Record<string, unknown>): Promise<unknown> {
    return {
      queued: true,
      payload
    };
  }
}

export const resendClient = new ResendClient();
