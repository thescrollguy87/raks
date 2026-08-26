const { PrismaClient } = require("@prisma/client");
const env = require("./env");
const logger = require("./logger");

// A single shared Prisma instance across the app (the standard pattern —
// creating a new PrismaClient per request exhausts the DB connection pool).
const prisma = new PrismaClient({
  log: env.isProd
    ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
    : [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }, { emit: "event", level: "query" }],
});

prisma.$on("warn", (e) => logger.warn(e.message));
prisma.$on("error", (e) => logger.error(e.message));
if (!env.isProd) {
  prisma.$on("query", (e) => logger.debug(`${e.query} — ${e.params} (${e.duration}ms)`));
}

module.exports = prisma;
