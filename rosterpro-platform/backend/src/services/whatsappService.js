const env = require("../config/env");
const logger = require("../config/logger");

let client = null;
function getClient() {
  if (client) return client;
  if (!env.twilio.accountSid) {
    logger.warn("Twilio not configured — WhatsApp messages will be logged, not sent. Set TWILIO_* in .env.");
    return null;
  }
  const twilio = require("twilio");
  client = twilio(env.twilio.accountSid, env.twilio.authToken);
  return client;
}

// `to` must be E.164 (e.g. +919876543210) — stored on User.phone. During
// Twilio Sandbox testing, the recipient must first send the sandbox join
// phrase to your Twilio WhatsApp number once (see backend README).
async function send(to, body) {
  const c = getClient();
  if (!c) {
    logger.info(`[whatsapp:not-configured] to=${to} body="${body}"`);
    return;
  }
  if (!to) throw new Error("Recipient has no phone number on file");
  await c.messages.create({ from: env.twilio.whatsappFrom, to: `whatsapp:${to}`, body });
}

module.exports = { send };
