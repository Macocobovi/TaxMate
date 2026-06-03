import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

const connection: ConnectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

export const walletCreationQueue = new Queue("wallet-creation", { connection });
export const businessVerificationPollQueue = new Queue("business-verification-poll", { connection });
export const onChainPaymentQueue = new Queue("on-chain-payment", { connection });
export const taxItemSyncQueue = new Queue("tax-item-sync", { connection });
export const emailSendQueue = new Queue("email-send", { connection });
export const invoiceExpiryQueue = new Queue("invoice-expiry", { connection });

export async function closeQueues(): Promise<void> {
  await Promise.all([
    walletCreationQueue.close(),
    businessVerificationPollQueue.close(),
    onChainPaymentQueue.close(),
    taxItemSyncQueue.close(),
    emailSendQueue.close(),
    invoiceExpiryQueue.close()
  ]);
}
