const env = require("./config/env");
const logger = require("./config/logger");
const app = require("./app");
const prisma = require("./config/prisma");
const { startScheduler } = require("./jobs/scheduledJobs");

const server = app.listen(env.port, () => {
  logger.info(`RosterPro backend listening on :${env.port} [${env.nodeEnv}]`);
  startScheduler();
});

// Graceful shutdown — important once this runs behind a load balancer /
// container orchestrator that sends SIGTERM on deploy/scale-down.
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info("Shutdown complete");
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason?.stack || reason });
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { stack: err.stack });
  process.exit(1);
});
