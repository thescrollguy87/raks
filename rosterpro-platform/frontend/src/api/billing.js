import { api } from "./client.js";

export function getBillingStatus() {
  return api.get("/api/billing/status");
}

export function getBillingCharges() {
  return api.get("/api/billing/charges");
}

export function createAuthorizationOrder() {
  return api.post("/api/billing/payment-method/order", {});
}

export function confirmPaymentMethod({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  return api.post("/api/billing/payment-method/confirm", { razorpayOrderId, razorpayPaymentId, razorpaySignature });
}
