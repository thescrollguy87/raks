// Loads and validates required environment variables once, at startup, so a
// missing secret fails loudly and immediately instead of surfacing as a
// confusing runtime error three requests later.
require("dotenv").config();

const REQUIRED = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
];

const missing = REQUIRED.filter(key => !process.env[key]);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill these in before starting the server.");
  process.exit(1);
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  corsOrigin: process.env.CORS_ORIGIN || "*",

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "30d",
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12", 10),

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || "RosterPro <no-reply@rosterpro.app>",
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
  },

  dailyReminderCron: process.env.DAILY_REMINDER_CRON || "0 18 * * *",
  billingCycleCron: process.env.BILLING_CYCLE_CRON || "0 7 * * *",
  tz: process.env.TZ || "Asia/Kolkata",

  // Optional like SMTP/Twilio above — the app boots fine without these
  // (billingService.getRazorpayClient() throws a clear error only when a
  // billing action is actually attempted), since a fresh deploy shouldn't
  // hard-fail just because Razorpay hasn't been configured yet.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  billing: {
    pricePerStaffPaise: parseInt(process.env.BILLING_PRICE_PER_STAFF_PAISE || "10000", 10), // Rs.100
    trialMonths: parseInt(process.env.BILLING_TRIAL_MONTHS || "2", 10),
    graceDays: parseInt(process.env.BILLING_GRACE_DAYS || "3", 10),
  },

  appUrl: process.env.APP_URL || "http://localhost:5173",

  isProd: (process.env.NODE_ENV || "development") === "production",
};
