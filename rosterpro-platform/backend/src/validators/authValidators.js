const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  mfaCode: z.string().length(6).optional(), // required only if the account has MFA enabled
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10, "Password must be at least 10 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/\d/, "Password must contain a number"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, "Password must be at least 10 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/\d/, "Password must contain a number"),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const mfaVerifySchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code"),
});

module.exports = {
  loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema,
  changePasswordSchema, verifyEmailSchema, mfaVerifySchema,
};
