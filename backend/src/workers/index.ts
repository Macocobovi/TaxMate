import { logger } from "../config/logger.js";
import { startOnChainPaymentWorker, stopOnChainPaymentWorker } from "./on-chain-payment.js";

export function startWorkers(): void {
  startOnChainPaymentWorker();
  logger.info("Background workers started");
}

export async function stopWorkers(): Promise<void> {
  await stopOnChainPaymentWorker();
}
