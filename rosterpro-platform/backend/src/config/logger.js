const winston = require("winston");
const env = require("./env");

// Structured JSON logs in production (so CloudWatch/any log aggregator can
// parse them), readable colored output in development.
const logger = winston.createLogger({
  level: env.isProd ? "info" : "debug",
  format: env.isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
          return `${timestamp} ${level}: ${message}${extra}`;
        })
      ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
