// Express doesn't catch rejected promises from async route handlers on its
// own (pre-Express 5). Wrapping every controller in this avoids a
// try/catch { next(err) } block in every single one of them.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
