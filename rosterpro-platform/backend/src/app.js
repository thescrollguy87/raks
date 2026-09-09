const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const morgan = require("morgan");

const env = require("./config/env");
const logger = require("./config/logger");
const routes = require("./routes");
const requestId = require("./middleware/requestId");
const { apiLimiter } = require("./middleware/rateLimiter");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

// Trust the first proxy hop (needed on Railway/Render/behind an AWS ALB) so
// req.ip reflects the real client IP instead of the load balancer's — this
// matters because req.ip goes straight into the audit trail.
app.set("trust proxy", 1);

app.use(requestId);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  // helmet's frameguard default is SAMEORIGIN; this app never needs to be
  // framed at all (frame-ancestors 'none' above already blocks that for
  // CSP-aware browsers) so the literal X-Frame-Options header matches that
  // intent for older browsers too.
  frameguard: { action: "deny" },
  // helmet's hsts default is 180 days; bump to the full 1 year this app's
  // deployment guide assumes (HTTPS-only via CloudFront/ACM or an nginx/ALB
  // TLS terminator — see infra/aws/DEPLOYMENT_GUIDE.md).
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

app.use(morgan(env.isProd ? "combined" : "dev", {
  stream: { write: (msg) => logger.http ? logger.http(msg.trim()) : logger.info(msg.trim()) },
}));

app.use("/api", apiLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
