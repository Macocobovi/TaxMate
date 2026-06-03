import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const server = app.listen(env.PORT, () => {
  logger.info(`Backend listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    logger.info("Server stopped");
  });
});
