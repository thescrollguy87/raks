const crypto = require("crypto");
const Razorpay = require("razorpay");
const env = require("../config/env");
const logger = require("../config/logger");

// Token-based Recurring Payments, deliberately NOT Razorpay's Subscriptions
// (Plans) API. Subscriptions assume a fixed amount per billing cycle; this
// platform's price is per-seat and changes every month as an airline adds
// or removes staff, so WE compute the amount each cycle and trigger the
// charge ourselves against a saved payment-method token. The three calls
// this file wraps are exactly Razorpay's documented flow for that:
//   1. customers.create           — once per airline
//   2. orders.create (+ token)    — the FIRST transaction, registers a token
//   3. payments.createRecurringPayment — every subsequent cycle, against
//      a fresh plain order for that cycle's real amount
// (Confirmed against the razorpay npm package's own bundled type
// definitions — node_modules/razorpay/dist/types/{orders,tokens,payments}.d.ts
// — since live docs access wasn't reachable from this environment.)

let realClient = null;
function getRealClient() {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) return null;
  if (!realClient) realClient = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  return realClient;
}

// ─── Fake client (no keys configured) ────────────────────────────────────────
// Mirrors the exact three call shapes above so billingService never branches
// on real-vs-fake — only this file knows the difference. Lets the entire
// state machine (auth → save token → monthly charge → decline → grace →
// read_only → reactivate) be exercised end-to-end in this environment
// without real Razorpay credentials. Swapping in real keys via
// RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET replaces this with the real SDK with
// no code change anywhere else.
let fakeIdSeq = 0;
function fakeId(prefix) { fakeIdSeq += 1; return `${prefix}_FAKE${Date.now().toString(36)}${fakeIdSeq}`; }

const fakeTokensByCustomer = new Map(); // customerId -> { id, last4, network }

function buildFakeClient() {
  let warned = false;
  function warnOnce() {
    if (warned) return;
    warned = true;
    logger.warn("[razorpay] RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set — using an in-process FAKE Razorpay client. No real money moves. Set both env vars to go live.");
  }

  return {
    __fake: true,
    customers: {
      async create({ name, email, contact }) {
        warnOnce();
        return { id: fakeId("cust"), name, email, contact, entity: "customer" };
      },
    },
    orders: {
      async create(params) {
        warnOnce();
        return { id: fakeId("order"), amount: params.amount, currency: params.currency || "INR", status: "created", entity: "order" };
      },
    },
    payments: {
      // In real life this is the id razorpay's Checkout.js hands back after
      // the customer completes the authorization payment. The fake
      // "checkout" (confirmAuthorization in billingService, dev-mode branch)
      // fabricates one of these directly, since there's no real card form.
      async fetch(paymentId) {
        warnOnce();
        const [, customerId] = paymentId.split("::");
        const token = fakeTokensByCustomer.get(customerId) || { id: fakeId("token"), last4: "4242", network: "Visa" };
        fakeTokensByCustomer.set(customerId, token);
        return {
          id: paymentId, entity: "payment", status: "captured", method: "card",
          token_id: token.id, customer_id: customerId,
          card: { last4: token.last4, network: token.network },
        };
      },
      async createRecurringPayment(params) {
        warnOnce();
        // Deterministic, explicit failure trigger for local verification
        // (see billingService.simulateChargeFailure / the SUPER_ADMIN-only
        // "run billing cycle now" debug endpoint) — never triggered by any
        // real card behavior, only by a caller that explicitly asked for it.
        if (params.notes && params.notes.__forceFailure === "true") {
          const err = new Error("Your card was declined by the issuing bank.");
          err.error = { description: "Your card was declined by the issuing bank.", code: "BAD_REQUEST_ERROR" };
          throw err;
        }
        return {
          razorpay_payment_id: fakeId("pay"), razorpay_order_id: params.order_id,
          status: "captured", entity: "payment",
        };
      },
    },
  };
}

const fakeClientSingleton = buildFakeClient();

function getClient() {
  return getRealClient() || fakeClientSingleton;
}

function isLive() {
  return !!getRealClient();
}

// For the dev-mode "complete authorization" path (no real Checkout.js /
// card form to hand back a payment id) — fabricates the payment id that
// customers.create + orders.create → fetch would have produced, keyed to
// the customer so fetch() returns a stable token per customer.
function fakeAuthorizationPaymentId(customerId) {
  return `pay::${customerId}::${fakeId("auth")}`;
}

// HMAC-SHA256 of "order_id|payment_id" using the key secret — Razorpay's
// documented signature check for confirming a Checkout.js callback wasn't
// forged. Skipped (always "valid") for the fake client, since there's no
// real signature to check without a real secret.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!isLive()) return true;
  const expected = crypto.createHmac("sha256", env.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}

module.exports = { getClient, isLive, verifyPaymentSignature, fakeAuthorizationPaymentId };
