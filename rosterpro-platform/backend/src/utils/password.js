const bcrypt = require("bcryptjs");
const env = require("../config/env");

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Minimum bar for a maintenance/ops tool handling licensing data: 10+ chars,
// at least one letter and one number. Tighten this if your security policy
// requires more (special chars, no dictionary words, etc).
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{10,}$/;

function isPasswordStrong(plain) {
  return PASSWORD_REGEX.test(plain);
}

module.exports = { hashPassword, comparePassword, isPasswordStrong };
