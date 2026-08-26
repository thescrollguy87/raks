const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const crypto = require("crypto");
const env = require("../config/env");

// mfaSecret is stored encrypted at rest (AES-256-GCM) rather than plaintext
// — it's effectively a long-lived password equivalent, so it gets the same
// treatment. The encryption key is a separate env var from JWT secrets so
// rotating one doesn't force rotating the other.
const ALGO = "aes-256-gcm";
function getKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error("MFA_ENCRYPTION_KEY is not set");
  return crypto.createHash("sha256").update(raw).digest(); // normalize to 32 bytes
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function generateSecret(userEmail) {
  const secret = speakeasy.generateSecret({
    name: `RosterPro (${userEmail})`,
    length: 20,
  });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url, encrypted: encrypt(secret.base32) };
}

async function generateQrCodeDataUrl(otpauthUrl) {
  return qrcode.toDataURL(otpauthUrl);
}

function verifyCode(encryptedSecret, code) {
  const base32 = decrypt(encryptedSecret);
  return speakeasy.totp.verify({
    secret: base32,
    encoding: "base32",
    token: code,
    window: 1, // allows the previous/next 30s window for clock drift
  });
}

module.exports = { generateSecret, generateQrCodeDataUrl, verifyCode };
