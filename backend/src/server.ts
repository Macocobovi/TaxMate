import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closeQueues } from "./queues/index.js";
import { startWorkers, stopWorkers } from "./workers/index.js";

const server = app.listen(env.PORT, () => {
  logger.info(`Backend listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
});

startWorkers();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`${signal} received; shutting down`);

  await stopWorkers();
  await closeQueues();
  server.close(() => {
    logger.info("Server stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
