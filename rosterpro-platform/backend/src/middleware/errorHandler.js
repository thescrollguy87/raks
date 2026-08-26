const { Prisma } = require("@prisma/client");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");
const env = require("../config/env");

// Translates Prisma's own error types into ApiError so callers never have to
// know Prisma exists — a unique-constraint violation becomes a clean 409,
// a not-found becomes a 404, etc.
function translatePrismaError(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const fields = err.meta?.target?.join(", ") || "field";
      return ApiError.conflict(`A record with this ${fields} already exists`);
    }
    if (err.code === "P2025") return ApiError.notFound("Record not found");
    if (err.code === "P2003") return ApiError.badRequest("Related record not found (foreign key constraint)");
  }
  return null;
}

// 404 handler — mounted after all routes, before the error handler.
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`No route: ${req.method} ${req.originalUrl}`));
}

// Must be mounted LAST, and must keep all four arguments (err, req, res,
// next) even though `next` is unused — that's how Express recognizes an
// error-handling middleware.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;
  if (!(error instanceof ApiError)) {
    error = translatePrismaError(err) || error;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) logger.error(error.message, { stack: error.stack, path: req.originalUrl });
    else logger.warn(error.message, { path: req.originalUrl, status: error.statusCode });

    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details || undefined,
    });
  }

  // Truly unexpected error — never leak internals to the client.
  logger.error(err.message, { stack: err.stack, path: req.originalUrl });
  res.status(500).json({
    error: "Internal server error",
    stack: env.isProd ? undefined : err.stack,
  });
}

module.exports = { errorHandler, notFoundHandler };
