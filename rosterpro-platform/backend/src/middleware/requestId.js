const crypto = require("crypto");

// A short, unique-enough id attached to every request — surfaced to the
// client only on error responses (as `correlationId`) so a user can quote
// it to support without the response ever needing to include a stack
// trace, query, or file path. Also echoed as a response header so it shows
// up in browser devtools/proxy logs without opening the response body.
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestId;
