// Unit tests for the per-seat billing state machine — trial bootstrap,
// staff-count x Rs.100 computation, and every cycle-processing transition
// (trial "would-be" log, trial->active conversion, charge success/failure,
// grace-period retry/expiry, read-only). Razorpay itself is mocked here
// (this is a pure logic test of billingService, not an integration test of
// the Razorpay SDK) — the live verification pass exercises the real
// integrations/razorpayClient.js fake client end-to-end instead.

jest.mock("../src/repositories/billingRepository");
jest.mock("../src/integrations/razorpayClient");
jest.mock("../src/services/notificationService");
jest.mock("../src/utils/auditTrail");

const billingRepo = require("../src/repositories/billingRepository");
const razorpay = require("../src/integrations/razorpayClient");
const notificationService = require("../src/services/notificationService");
const billingService = require("../src/services/billingService");

const AIRLINE_ID = "airline-1";
const BILLING_ID = "billing-1";

function makeBilling(overrides = {}) {
  return {
    id: BILLING_ID, airlineId: AIRLINE_ID, status: "trialing",
    trialStartAt: new Date("2026-01-01T00:00:00Z"), trialEndAt: new Date("2026-03-01T00:00:00Z"),
    currentPeriodStart: new Date("2026-01-01T00:00:00Z"), currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
    nextBillingDate: new Date("2026-02-01T00:00:00Z"),
    razorpayCustomerId: "cust_1", paymentMethodToken: null,
    failureCount: 0, firstFailureAt: null, graceEndsAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  billingRepo.createCharge.mockResolvedValue({});
  billingRepo.update.mockImplementation((id, data) => Promise.resolve({ id, ...data }));
  billingRepo.findAdminsForAirline.mockResolvedValue([{ id: "u1", email: "admin@test.com" }]);
  notificationService.dispatch.mockResolvedValue({ sent: true });

  const fakeClient = {
    customers: { create: jest.fn().mockResolvedValue({ id: "cust_new" }) },
    orders: { create: jest.fn().mockResolvedValue({ id: "order_1" }) },
    payments: {
      fetch: jest.fn().mockResolvedValue({ token_id: "token_1", card: { last4: "4242", network: "Visa" } }),
      createRecurringPayment: jest.fn().mockResolvedValue({ razorpay_payment_id: "pay_1", status: "captured" }),
    },
  };
  razorpay.getClient.mockReturnValue(fakeClient);
  razorpay.isLive.mockReturnValue(false);
  razorpay.verifyPaymentSignature.mockReturnValue(true);
  razorpay.fakeAuthorizationPaymentId.mockReturnValue("pay::cust_1::fake");
});

describe("billingService.startTrial", () => {
  it("starts a 2-month trial with a 1-month first anchor", async () => {
    billingRepo.create.mockImplementation(data => Promise.resolve({ id: "new-billing", ...data }));
    const result = await billingService.startTrial(AIRLINE_ID, "actor-1");

    expect(result.status).toBe("trialing");
    const trialMonths = result.trialEndAt.getUTCMonth() - result.trialStartAt.getUTCMonth();
    expect(((trialMonths + 12) % 12)).toBe(2);
    expect(result.nextBillingDate.getTime()).toBe(result.currentPeriodEnd.getTime());
  });
});

describe("billingService.getStatus", () => {
  it("computes the charge amount as staffCount x price exactly, never assumed", async () => {
    billingRepo.getByAirlineId.mockResolvedValue(makeBilling({ status: "active", paymentMethodToken: "tok" }));
    billingRepo.countActiveStaff.mockResolvedValue(37);

    const status = await billingService.getStatus(AIRLINE_ID);

    expect(status.staffCount).toBe(37);
    expect(status.estimatedNextChargeRupees).toBe(37 * 100); // Rs.100/staff
  });
});

describe("billingService.processTenantCycle — trial", () => {
  it("logs a would-be charge and advances the anchor without charging, while trial is still active", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(10);
    const billing = makeBilling({ nextBillingDate: new Date("2026-02-01T00:00:00Z"), trialEndAt: new Date("2026-03-01T00:00:00Z") });
    const now = new Date("2026-02-01T00:00:00Z"); // still before trialEndAt

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("trial_would_be_logged");
    expect(billingRepo.createCharge).toHaveBeenCalledWith(expect.objectContaining({ status: "would_be", staffCount: 10, amountPaise: 10 * 10000 }));
    const clientUsed = razorpay.getClient.mock.calls.length;
    expect(clientUsed).toBe(0); // never touches Razorpay for a trial log
  });

  it("goes read-only when the trial expires with no payment method on file", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(5);
    const billing = makeBilling({ trialEndAt: new Date("2026-03-01T00:00:00Z"), paymentMethodToken: null });
    const now = new Date("2026-03-02T00:00:00Z"); // past trialEndAt

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("trial_expired_read_only");
    expect(billingRepo.update).toHaveBeenCalledWith(BILLING_ID, expect.objectContaining({ status: "read_only" }));
    expect(notificationService.dispatch).toHaveBeenCalled();
  });

  it("converts trial to active on a successful first charge when a payment method is on file", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(8);
    const billing = makeBilling({ trialEndAt: new Date("2026-03-01T00:00:00Z"), paymentMethodToken: "tok_1" });
    const now = new Date("2026-03-02T00:00:00Z");

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("trial_converted_active");
    expect(billingRepo.update).toHaveBeenCalledWith(BILLING_ID, expect.objectContaining({ status: "active" }));
    expect(billingRepo.createCharge).toHaveBeenCalledWith(expect.objectContaining({ status: "success", amountPaise: 8 * 10000 }));
  });

  it("starts a grace period (stays active, not read-only) when the first post-trial charge fails", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(6);
    const client = razorpay.getClient();
    client.payments.createRecurringPayment.mockRejectedValue({ error: { description: "Card declined" } });
    const billing = makeBilling({ trialEndAt: new Date("2026-03-01T00:00:00Z"), paymentMethodToken: "tok_1" });
    const now = new Date("2026-03-02T00:00:00Z");

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("trial_first_charge_failed_grace_started");
    const updateCall = billingRepo.update.mock.calls.find(c => c[1].status === "active" && c[1].graceEndsAt);
    expect(updateCall).toBeTruthy(); // active, NOT read_only — the grace period, not immediate lockout
    expect(billingRepo.createCharge).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failureReason: "Card declined" }));
  });
});

describe("billingService.processTenantCycle — normal active cycle", () => {
  it("charges and advances the period on a normal successful monthly cycle", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(20);
    const billing = makeBilling({ status: "active", paymentMethodToken: "tok_1", graceEndsAt: null });
    const now = new Date("2026-02-01T00:00:00Z");

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("charged");
    expect(billingRepo.createCharge).toHaveBeenCalledWith(expect.objectContaining({ status: "success", amountPaise: 20 * 10000 }));
  });

  it("charges nothing and never touches Razorpay for a zero-staff tenant", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(0);
    const billing = makeBilling({ status: "active", paymentMethodToken: "tok_1" });
    const now = new Date("2026-02-01T00:00:00Z");

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("charged");
    expect(billingRepo.createCharge).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 0 }));
    expect(razorpay.getClient).not.toHaveBeenCalled();
  });
});

describe("billingService.processTenantCycle — grace period", () => {
  it("retries and succeeds: clears the grace period and resumes active billing", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(15);
    const billing = makeBilling({
      status: "active", paymentMethodToken: "tok_1", failureCount: 1,
      firstFailureAt: new Date("2026-02-01T00:00:00Z"), graceEndsAt: new Date("2026-02-04T00:00:00Z"),
    });
    const now = new Date("2026-02-02T00:00:00Z"); // within the grace window

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("retry_succeeded");
    expect(billingRepo.update).toHaveBeenCalledWith(BILLING_ID, expect.objectContaining({ status: "active", failureCount: 0, graceEndsAt: null }));
  });

  it("retries and fails again: stays active, increments failureCount, does not go read-only yet", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(15);
    const client = razorpay.getClient();
    client.payments.createRecurringPayment.mockRejectedValue({ error: { description: "Card declined" } });
    const billing = makeBilling({
      status: "active", paymentMethodToken: "tok_1", failureCount: 1,
      firstFailureAt: new Date("2026-02-01T00:00:00Z"), graceEndsAt: new Date("2026-02-04T00:00:00Z"),
    });
    const now = new Date("2026-02-02T00:00:00Z");

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("retry_failed");
    expect(result.failureCount).toBe(2);
    const readOnlyCall = billingRepo.update.mock.calls.find(c => c[1].status === "read_only");
    expect(readOnlyCall).toBeUndefined(); // still within grace — must not jump to read_only
  });

  it("moves to read-only once the grace period has actually run out", async () => {
    billingRepo.countActiveStaff.mockResolvedValue(15);
    const billing = makeBilling({
      status: "active", paymentMethodToken: "tok_1", failureCount: 3,
      firstFailureAt: new Date("2026-02-01T00:00:00Z"), graceEndsAt: new Date("2026-02-04T00:00:00Z"),
    });
    const now = new Date("2026-02-05T00:00:00Z"); // past graceEndsAt

    const result = await billingService.processTenantCycle(billing, now);

    expect(result.action).toBe("grace_expired_read_only");
    expect(billingRepo.update).toHaveBeenCalledWith(BILLING_ID, expect.objectContaining({ status: "read_only" }));
    expect(notificationService.dispatch).toHaveBeenCalled();
  });
});

describe("billingService.confirmPaymentMethod — reactivation", () => {
  it("immediately restores active status and resets the cycle when a read_only tenant adds a payment method", async () => {
    billingRepo.getByAirlineId.mockResolvedValue(makeBilling({ status: "read_only", paymentMethodToken: null }));
    billingRepo.countActiveStaff.mockResolvedValue(12);

    await billingService.confirmPaymentMethod(AIRLINE_ID, {
      razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", razorpaySignature: "sig",
    }, { sub: "actor-1", email: "a@b.com" }, {});

    const updateCall = billingRepo.update.mock.calls[0];
    expect(updateCall[1]).toEqual(expect.objectContaining({ status: "active", failureCount: 0, graceEndsAt: null }));
  });
});
