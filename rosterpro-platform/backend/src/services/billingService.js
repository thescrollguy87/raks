const billingRepo = require("../repositories/billingRepository");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const env = require("../config/env");
const logger = require("../config/logger");
const razorpay = require("../integrations/razorpayClient");
const notificationService = require("./notificationService");

const PRICE_PAISE = env.billing.pricePerStaffPaise;
const TRIAL_MONTHS = env.billing.trialMonths;
const GRACE_DAYS = env.billing.graceDays;
const MIN_AUTH_AMOUNT_PAISE = 100; // Rs.1 — the authorization transaction is just to register the token, not a real charge

function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function paiseToRupees(paise) { return Math.round(paise) / 100; }

// ─── Trial bootstrap ──────────────────────────────────────────────────────
// Called from airlineRepository.createAirlineWithAdmin's transaction the
// moment a new tenant is provisioned — no manual step, per the spec. `tx` is
// an optional Prisma transaction client; when omitted this runs against the
// default client (used by the one-off backfill script for the pre-existing
// tenant — see scripts/backfill-billing.js).
async function startTrial(airlineId, actorId, tx) {
  const now = new Date();
  const trialEndAt = addMonths(now, TRIAL_MONTHS);
  const data = {
    airlineId,
    status: "trialing",
    trialStartAt: now,
    trialEndAt,
    currentPeriodStart: now,
    currentPeriodEnd: addMonths(now, 1),
    nextBillingDate: addMonths(now, 1),
    createdById: actorId || null,
    updatedById: actorId || null,
  };
  return tx ? tx.airlineBilling.create({ data }) : billingRepo.create(data);
}

// ─── Status / preview (read side — the Billing page) ─────────────────────
async function getStatus(airlineId) {
  const billing = await billingRepo.getByAirlineId(airlineId);
  if (!billing) throw ApiError.notFound("No billing record for this airline");

  const staffCount = await billingRepo.countActiveStaff(airlineId);
  const estimatedAmountPaise = staffCount * PRICE_PAISE;
  const now = new Date();

  return {
    status: billing.status,
    trialStartAt: billing.trialStartAt,
    trialEndAt: billing.trialEndAt,
    daysUntilTrialEnd: billing.status === "trialing" ? Math.ceil((billing.trialEndAt - now) / 86400000) : null,
    currentPeriodStart: billing.currentPeriodStart,
    currentPeriodEnd: billing.currentPeriodEnd,
    nextBillingDate: billing.nextBillingDate,
    daysUntilNextCharge: Math.ceil((billing.nextBillingDate - now) / 86400000),
    staffCount,
    pricePerStaffRupees: paiseToRupees(PRICE_PAISE),
    estimatedNextChargeRupees: paiseToRupees(estimatedAmountPaise),
    hasPaymentMethod: !!billing.paymentMethodToken,
    paymentMethodLast4: billing.paymentMethodLast4,
    paymentMethodNetwork: billing.paymentMethodNetwork,
    paymentMethodAddedAt: billing.paymentMethodAddedAt,
    inGracePeriod: !!billing.graceEndsAt,
    graceEndsAt: billing.graceEndsAt,
    failureCount: billing.failureCount,
    isLiveRazorpay: razorpay.isLive(),
  };
}

function listCharges(airlineId) {
  return billingRepo.getByAirlineId(airlineId).then(billing => {
    if (!billing) throw ApiError.notFound("No billing record for this airline");
    return billingRepo.listCharges(billing.id);
  });
}

// ─── Add / confirm payment method ─────────────────────────────────────────
// Step 1: create (or reuse) a Razorpay customer + an authorization Order
// carrying a `token` block — this is the ONE transaction that registers a
// reusable token, per Razorpay's Recurring Payments flow. The frontend
// takes the returned order_id to Razorpay Checkout.js.
async function createAuthorizationOrder(airlineId, actor) {
  const billing = await billingRepo.getByAirlineId(airlineId);
  if (!billing) throw ApiError.notFound("No billing record for this airline");

  const client = razorpay.getClient();
  let customerId = billing.razorpayCustomerId;
  if (!customerId) {
    const customer = await client.customers.create({
      name: actor.name || "Airline Admin",
      email: actor.email,
      contact: undefined,
      fail_existing: 0,
    });
    customerId = customer.id;
    await billingRepo.update(billing.id, { razorpayCustomerId: customerId, updatedById: actor.sub });
  }

  const order = await client.orders.create({
    amount: MIN_AUTH_AMOUNT_PAISE,
    currency: "INR",
    customer_id: customerId,
    payment_capture: true,
    method: "card",
    token: {
      max_amount: 100000000, // Rs.10,00,000 ceiling per charge — generous upper bound, never actually approached at Rs.100/seat
      expire_at: Math.floor(addMonths(new Date(), 120).getTime() / 1000), // 10 years out
      frequency: "monthly",
    },
  });

  return {
    orderId: order.id,
    amount: MIN_AUTH_AMOUNT_PAISE,
    currency: "INR",
    customerId,
    razorpayKeyId: env.razorpay.keyId || null,
    isLive: razorpay.isLive(),
    // null (not undefined!) on a live response — `undefined` is silently
    // dropped by JSON.stringify, which would leave this key missing from
    // the response entirely rather than explicitly null, and the frontend
    // checks `order.isLive`, not whether this key is present. Only used
    // in dev/fake mode, to skip loading the real Checkout.js widget and
    // confirm straight away without the frontend needing to know how the
    // fake client encodes anything.
    devFakePaymentId: razorpay.isLive() ? null : razorpay.fakeAuthorizationPaymentId(customerId),
  };
}

// Step 2: the frontend hands back what Checkout.js returned. Verify the
// signature, fetch the payment to read the token_id Razorpay generated,
// and save it. If the airline was read_only (or trial had already lapsed
// with no card), this is also the reactivate flow — full write access
// resumes immediately and the next cycle proceeds from today.
async function confirmPaymentMethod(airlineId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }, actor, req) {
  const billing = await billingRepo.getByAirlineId(airlineId);
  if (!billing) throw ApiError.notFound("No billing record for this airline");

  const valid = razorpay.verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature });
  if (!valid) throw ApiError.badRequest("Payment verification failed — signature mismatch");

  const client = razorpay.getClient();
  const payment = await client.payments.fetch(razorpayPaymentId);
  if (!payment.token_id) throw ApiError.badRequest("Payment did not produce a reusable payment method token");

  const wasReadOnly = billing.status === "read_only" || billing.status === "cancelled";
  const now = new Date();

  const patch = {
    paymentMethodToken: payment.token_id,
    paymentMethodLast4: payment.card?.last4 || null,
    paymentMethodNetwork: payment.card?.network || null,
    paymentMethodAddedAt: now,
    updatedById: actor.sub,
  };
  if (wasReadOnly) {
    Object.assign(patch, {
      status: "active",
      failureCount: 0, firstFailureAt: null, graceEndsAt: null,
      currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1),
      nextBillingDate: addMonths(now, 1),
    });
  }

  const updated = await billingRepo.update(billing.id, patch);

  await auditTrail.logActivity(
    wasReadOnly ? "Subscription reactivated" : "Payment method added",
    `${payment.card?.network || "Card"} ending ${payment.card?.last4 || "----"}`,
    null, actor, req
  );
  if (wasReadOnly) {
    notifyAdmins(airlineId, "reactivated", { }).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
  }

  return getStatus(airlineId).then(status => ({ ...status, _updated: updated.status }));
}

// ─── Notifications ─────────────────────────────────────────────────────────
const SUBJECTS = {
  payment_failed: "Payment failed — RosterPro subscription",
  payment_retry: "Still retrying your payment — RosterPro subscription",
  grace_ending: "Last chance: add a payment method before your account goes read-only",
  read_only: "Your RosterPro account is now read-only",
  reactivated: "Your RosterPro account is fully active again",
  trial_will_expire: "Your RosterPro free trial is ending soon",
};
function billingMessage(kind, ctx) {
  switch (kind) {
    case "payment_failed":
      return `We couldn't charge your saved payment method for this month's RosterPro subscription (₹${ctx.amountRupees} for ${ctx.staffCount} staff). We'll retry automatically over the next ${GRACE_DAYS} days — no action needed yet, but please check your payment method if this continues.`;
    case "payment_retry":
      return `We tried again to charge your RosterPro subscription (₹${ctx.amountRupees}) and it still failed. We'll keep retrying until ${ctx.graceEndsAt.toISOString().slice(0, 10)}, after which your account will move to read-only if payment isn't resolved.`;
    case "grace_ending":
      return `This is a reminder: your RosterPro account will become read-only tomorrow (${ctx.graceEndsAt.toISOString().slice(0, 10)}) unless your payment method is updated and a retry succeeds.`;
    case "read_only":
      return `Your RosterPro account is now read-only — you can still view all data, but creating, editing, or deleting anything is blocked until a payment method is added. Add one from the Billing page to restore full access immediately.`;
    case "reactivated":
      return `Thanks — your payment method was added and full write access to RosterPro has been restored immediately. Your next billing cycle proceeds normally from today.`;
    case "trial_will_expire":
      return `Your RosterPro free trial ends on ${ctx.trialEndAt.toISOString().slice(0, 10)}. Add a payment method before then to keep full access — otherwise your account will switch to read-only (you'll still be able to view everything, just not make changes).`;
    default:
      return "";
  }
}
async function notifyAdmins(airlineId, kind, ctx) {
  const admins = await billingRepo.findAdminsForAirline(airlineId);
  const subject = SUBJECTS[kind];
  const body = billingMessage(kind, ctx);
  await Promise.all(admins.map(u => notificationService.dispatch(u, "EMAIL", `billing_${kind}`, subject, body)));
}

// ─── The daily job ─────────────────────────────────────────────────────────
// `now` is injectable so both the real daily cron and the SUPER_ADMIN-only
// "run billing cycle now" debug endpoint (billingController.runCycleNow —
// the mechanism behind the verify checklist's "fast-forward the trial"
// step) share EXACTLY this logic; only what they call `now` differs.
async function runDueCycles(now = new Date(), { onlyAirlineId, forceFailure } = {}) {
  const [due, inGrace] = await Promise.all([
    billingRepo.listDueForCycle(now),
    billingRepo.listInGracePeriod(now),
  ]);
  const all = onlyAirlineId
    ? [...due, ...inGrace].filter(b => b.airlineId === onlyAirlineId)
    : [...due, ...inGrace];

  const results = [];
  for (const billing of all) {
    try {
      results.push(await processTenantCycle(billing, now, { forceFailure }));
    } catch (err) {
      logger.error(`[billing] cycle processing failed for airline ${billing.airlineId}: ${err.message}`);
      results.push({ airlineId: billing.airlineId, error: err.message });
    }
  }
  return results;
}

async function processTenantCycle(billing, now, { forceFailure } = {}) {
  const staffCount = await billingRepo.countActiveStaff(billing.airlineId);
  const amountPaise = staffCount * PRICE_PAISE;

  // ── Mid-grace-period: a retry is due today regardless of nextBillingDate ──
  if (billing.graceEndsAt) {
    if (now > billing.graceEndsAt) {
      await billingRepo.update(billing.id, { status: "read_only", updatedById: null });
      notifyAdmins(billing.airlineId, "read_only", {}).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
      await auditTrail.logActivity("Subscription moved to read-only", `Grace period ended with no successful payment (${billing.failureCount} failed attempts)`, null, systemActor(), null);
      return { airlineId: billing.airlineId, action: "grace_expired_read_only" };
    }

    const attempt = await attemptCharge(billing, staffCount, amountPaise, billing.currentPeriodStart, billing.currentPeriodEnd, billing.failureCount + 1, forceFailure);
    if (attempt.success) {
      await billingRepo.update(billing.id, {
        status: "active", failureCount: 0, firstFailureAt: null, graceEndsAt: null,
        currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1), nextBillingDate: addMonths(now, 1),
        updatedById: null,
      });
      notifyAdmins(billing.airlineId, "reactivated", {}).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
      return { airlineId: billing.airlineId, action: "retry_succeeded" };
    }

    const newFailureCount = billing.failureCount + 1;
    await billingRepo.update(billing.id, { failureCount: newFailureCount, updatedById: null });
    const isLastDay = addDays(now, 1) >= billing.graceEndsAt;
    notifyAdmins(billing.airlineId, isLastDay ? "grace_ending" : "payment_retry", { amountRupees: paiseToRupees(amountPaise), graceEndsAt: billing.graceEndsAt }).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
    return { airlineId: billing.airlineId, action: "retry_failed", failureCount: newFailureCount };
  }

  // ── Still in trial ──────────────────────────────────────────────────────
  if (billing.status === "trialing") {
    if (now < billing.trialEndAt) {
      await billingRepo.createCharge({
        billingId: billing.id, periodStart: billing.currentPeriodStart, periodEnd: billing.nextBillingDate,
        staffCount, amountPaise, status: "would_be", attemptNumber: 1,
      });
      const nextAnchor = addMonths(billing.nextBillingDate, 1);
      const clamped = nextAnchor > billing.trialEndAt ? billing.trialEndAt : nextAnchor;
      await billingRepo.update(billing.id, {
        currentPeriodStart: billing.nextBillingDate, currentPeriodEnd: clamped, nextBillingDate: clamped, updatedById: null,
      });
      return { airlineId: billing.airlineId, action: "trial_would_be_logged", amountPaise };
    }

    // Trial just expired.
    if (!billing.paymentMethodToken) {
      await billingRepo.update(billing.id, { status: "read_only", updatedById: null });
      notifyAdmins(billing.airlineId, "read_only", {}).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
      await auditTrail.logActivity("Subscription moved to read-only", "2-month trial ended with no payment method on file", null, systemActor(), null);
      return { airlineId: billing.airlineId, action: "trial_expired_read_only" };
    }

    // Has a card — first real charge, trial converts to active either way
    // (a decline here gets the same grace treatment as any other cycle).
    const attempt = await attemptCharge(billing, staffCount, amountPaise, billing.currentPeriodStart, billing.trialEndAt, 1, forceFailure);
    if (attempt.success) {
      await billingRepo.update(billing.id, {
        status: "active", currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1), nextBillingDate: addMonths(now, 1), updatedById: null,
      });
      return { airlineId: billing.airlineId, action: "trial_converted_active" };
    }
    await billingRepo.update(billing.id, {
      status: "active", failureCount: 1, firstFailureAt: now, graceEndsAt: addDays(now, GRACE_DAYS), updatedById: null,
    });
    notifyAdmins(billing.airlineId, "payment_failed", { amountRupees: paiseToRupees(amountPaise), staffCount }).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
    return { airlineId: billing.airlineId, action: "trial_first_charge_failed_grace_started" };
  }

  // ── Normal monthly cycle (active, no unresolved failure) ────────────────
  if (billing.status === "active") {
    if (!billing.paymentMethodToken) {
      // Shouldn't happen (active implies a token was saved) — fail safe
      // rather than crash the job on an inconsistent row.
      await billingRepo.update(billing.id, { status: "read_only", updatedById: null });
      notifyAdmins(billing.airlineId, "read_only", {}).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
      return { airlineId: billing.airlineId, action: "active_no_token_read_only" };
    }

    const attempt = await attemptCharge(billing, staffCount, amountPaise, billing.currentPeriodStart, billing.currentPeriodEnd, 1, forceFailure);
    if (attempt.success) {
      await billingRepo.update(billing.id, {
        currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1), nextBillingDate: addMonths(now, 1), updatedById: null,
      });
      return { airlineId: billing.airlineId, action: "charged" };
    }
    await billingRepo.update(billing.id, { failureCount: 1, firstFailureAt: now, graceEndsAt: addDays(now, GRACE_DAYS), updatedById: null });
    notifyAdmins(billing.airlineId, "payment_failed", { amountRupees: paiseToRupees(amountPaise), staffCount }).catch(err => logger.warn(`[billing] notification failed: ${err.message}`));
    return { airlineId: billing.airlineId, action: "charge_failed_grace_started" };
  }

  return { airlineId: billing.airlineId, action: "skipped", status: billing.status };
}

async function attemptCharge(billing, staffCount, amountPaise, periodStart, periodEnd, attemptNumber, forceFailure) {
  const safeAmount = Math.max(amountPaise, 0);

  // Nothing owed — no active staff this period. Nothing to charge, so
  // don't touch Razorpay at all (its orders require a minimum amount).
  if (safeAmount === 0) {
    await billingRepo.createCharge({
      billingId: billing.id, periodStart, periodEnd, staffCount, amountPaise: 0,
      status: "success", attemptNumber,
    });
    return { success: true };
  }

  const client = razorpay.getClient();
  try {
    const order = await client.orders.create({
      amount: safeAmount,
      currency: "INR",
      receipt: `${billing.id}:${periodStart.toISOString().slice(0, 10)}`,
      notes: { airlineId: billing.airlineId, staffCount: String(staffCount), ...(forceFailure ? { __forceFailure: "true" } : {}) },
    });

    const payment = await client.payments.createRecurringPayment({
      amount: safeAmount, currency: "INR", order_id: order.id,
      email: undefined, contact: undefined,
      customer_id: billing.razorpayCustomerId, token: billing.paymentMethodToken,
      recurring: true, description: `RosterPro subscription — ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
      notes: forceFailure ? { __forceFailure: "true" } : {},
    });

    await billingRepo.createCharge({
      billingId: billing.id, periodStart, periodEnd, staffCount, amountPaise: safeAmount,
      status: "success", attemptNumber, razorpayOrderId: order.id, razorpayPaymentId: payment.razorpay_payment_id,
    });
    return { success: true, paymentId: payment.razorpay_payment_id };
  } catch (err) {
    const reason = err.error?.description || err.message || "Charge failed";
    await billingRepo.createCharge({
      billingId: billing.id, periodStart, periodEnd, staffCount, amountPaise: safeAmount,
      status: "failed", attemptNumber, failureReason: reason,
    });
    return { success: false, failureReason: reason };
  }
}

// A system-initiated audit entry (the scheduled job, not a logged-in user)
// still needs an `actor` shape auditTrail can read a name/id off of.
function systemActor() {
  return { sub: null, name: "Billing job", email: null, roles: ["SYSTEM"] };
}

module.exports = {
  startTrial, getStatus, listCharges,
  createAuthorizationOrder, confirmPaymentMethod,
  runDueCycles, processTenantCycle,
  addMonths, addDays,
};
