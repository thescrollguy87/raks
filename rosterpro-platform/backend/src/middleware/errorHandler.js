const { Prisma } = require("@prisma/client");
const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

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
  const correlationId = req.id;

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) logger.error(error.message, { stack: error.stack, path: req.originalUrl, correlationId });
    else logger.warn(error.message, { path: req.originalUrl, status: error.statusCode, correlationId });

    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details || undefined,
      correlationId,
    });
  }

  // Truly unexpected error — never leak internals (stack trace, query
  // details, file paths) to the client in ANY environment. The full stack
  // goes to the server-side log only, keyed by correlationId so it can be
  // matched to what the client sees.
  logger.error(err.message, { stack: err.stack, path: req.originalUrl, correlationId });
  res.status(500).json({
    error: "Internal server error",
    correlationId,
  });
}

module.exports = { errorHandler, notFoundHandler };
