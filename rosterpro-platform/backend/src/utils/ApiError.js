// Every deliberate error thrown in a service/controller should be an
// ApiError, so the central error handler (middleware/errorHandler.js) can
// tell "expected, user-facing error" apart from "unexpected bug" and respond
// accordingly (status code + safe message vs 500 + generic message).
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details; // e.g. zod validation issues — safe to expose
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) { return new ApiError(400, message, details); }
  static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }
  static forbidden(message = "Forbidden") { return new ApiError(403, message); }
  static paymentRequired(message = "Payment required") { return new ApiError(402, message); }
  static notFound(message = "Not found") { return new ApiError(404, message); }
  static conflict(message = "Conflict") { return new ApiError(409, message); }
  static tooManyRequests(message = "Too many requests") { return new ApiError(429, message); }
  static internal(message = "Internal server error") { return new ApiError(500, message); }
}

module.exports = ApiError;
