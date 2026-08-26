const ApiError = require("../utils/ApiError");

// Usage: router.post("/login", validate(loginSchema), controller)
// Validates req.body against a zod schema; on failure, throws a 400 with the
// full list of issues (safe to expose — these are just "email is required"
// style messages, not internal details).
function validate(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map(i => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return next(ApiError.badRequest("Validation failed", details));
    }
    req.body = result.data; // parsed/coerced values replace the raw body
    next();
  };
}

function validateQuery(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map(i => ({ field: i.path.join("."), message: i.message }));
      return next(ApiError.badRequest("Invalid query parameters", details));
    }
    req.query = result.data;
    next();
  };
}

module.exports = { validate, validateQuery };
