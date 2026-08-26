const rateLimit = require("express-rate-limit");

// General API limit — generous, just a backstop against runaway clients/bugs.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Tight limit on auth endpoints specifically — this is what actually matters
// for security (brute-forcing logins / password-reset requests / OTP guesses).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only counts failed attempts toward the limit
  message: { error: "Too many attempts, please try again in 15 minutes" },
});

module.exports = { apiLimiter, authLimiter };
