import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as billingApi from "../api/billing.js";

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_SRC;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Couldn't load Razorpay's checkout script"));
    document.body.appendChild(script);
  });
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtMoney(rupees) {
  return `₹${Number(rupees).toLocaleString("en-IN")}`;
}

const STATUS_LABEL = {
  trialing: { label: "Free Trial", tone: "info" },
  active: { label: "Active", tone: "green" },
  read_only: { label: "Read-only", tone: "red" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export default function BillingPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [charges, setCharges] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  usePageHeader({ title: "Billing", subtitle: "Subscription, payment method, and charge history" });

  const load = useCallback(() => {
    setError("");
    Promise.all([billingApi.getBillingStatus(), billingApi.getBillingCharges()])
      .then(([s, c]) => { setStatus(s); setCharges(c); })
      .catch(err => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function handleAddPaymentMethod() {
    setBusy(true);
    setError("");
    try {
      const order = await billingApi.createAuthorizationOrder();

      if (!order.isLive) {
        // Dev/fake mode — no real Razorpay keys configured (see
        // src/integrations/razorpayClient.js on the backend). Confirms
        // immediately with the server-fabricated fake payment id instead
        // of opening a real card form.
        await billingApi.confirmPaymentMethod({
          razorpayOrderId: order.orderId, razorpayPaymentId: order.devFakePaymentId, razorpaySignature: "dev-mode",
        });
        load();
        return;
      }

      await loadRazorpayScript();
      const rzp = new window.Razorpay({
        key: order.razorpayKeyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "RosterPro",
        description: "Add payment method for RosterPro subscription",
        recurring: 1,
        prefill: { email: user?.email, name: user?.fullName },
        theme: { color: "#00c6ff" },
        handler: async (response) => {
          try {
            await billingApi.confirmPaymentMethod({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            load();
          } catch (err) {
            setError(err.message);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
      return; // busy cleared by handler/ondismiss, not the finally below
    } catch (err) {
      setError(err.message);
    } finally {
      if (!window.Razorpay) setBusy(false);
    }
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!status || !charges) return <div className="card">Loading billing…</div>;

  const st = STATUS_LABEL[status.status] || { label: status.status, tone: "info" };

  return (
    <div>
      {status.status === "read_only" && (
        <div className="ab red">
          🔒 This account is read-only. Every screen still loads normally, but nothing can be created, edited, or deleted until a payment method is added below.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="card">
            <div className="card-title">Subscription Status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span className={`tag ${st.tone === "red" ? "hrs-over" : st.tone === "green" ? "hrs-ok" : ""}`} style={{ fontSize: 12, padding: "4px 10px" }}>{st.label}</span>
              {!status.isLiveRazorpay && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>(dev mode — no live Razorpay keys configured)</span>}
            </div>

            {status.status === "trialing" && (
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                Trial ends <strong>{fmtDate(status.trialEndAt)}</strong>
                {" "}({Math.max(status.daysUntilTrialEnd, 0)} day{status.daysUntilTrialEnd === 1 ? "" : "s"} left).
                {!status.hasPaymentMethod && " Add a payment method before then to avoid becoming read-only."}
              </div>
            )}
            {status.status === "active" && (
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                Next charge on <strong>{fmtDate(status.nextBillingDate)}</strong> ({Math.max(status.daysUntilNextCharge, 0)} day{status.daysUntilNextCharge === 1 ? "" : "s"} away).
                {status.inGracePeriod && (
                  <div className="ab amber" style={{ marginTop: 8 }}>
                    ⚠ A recent charge failed ({status.failureCount} attempt{status.failureCount === 1 ? "" : "s"}). We're retrying automatically until {fmtDate(status.graceEndsAt)}, after which this account becomes read-only if unresolved.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <div className="stat-card sky">
                <div className="stat-label">Active Staff</div>
                <div className="stat-value">{status.staffCount}</div>
              </div>
              <div className="stat-card sky">
                <div className="stat-label">{status.status === "trialing" ? "Would-be Charge" : "Next Charge"}</div>
                <div className="stat-value">{fmtMoney(status.estimatedNextChargeRupees)}</div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 8 }}>
              {fmtMoney(status.pricePerStaffRupees)} per active staff member per month — computed live from your current staff count, not a fixed plan.
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">Payment Method</div>
            {status.hasPaymentMethod ? (
              <div style={{ fontSize: 12, marginBottom: 12 }}>
                {status.paymentMethodNetwork || "Card"} ending in <strong>{status.paymentMethodLast4 || "----"}</strong>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>Added {fmtDate(status.paymentMethodAddedAt)}</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>No payment method on file yet.</div>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleAddPaymentMethod}>
              {busy ? "Opening checkout…" : status.hasPaymentMethod ? "Update Payment Method" : "Add Payment Method"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Charge History</div>
        <table className="rt" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingLeft: 9 }}>Date</th>
              <th>Period</th>
              <th>Staff</th>
              <th>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: "left" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {charges.map(c => (
              <tr key={c.id}>
                <td style={{ textAlign: "left", paddingLeft: 9 }}>{fmtDate(c.createdAt)}</td>
                <td style={{ textAlign: "center" }}>{fmtDate(c.periodStart)} – {fmtDate(c.periodEnd)}</td>
                <td style={{ textAlign: "center" }}>{c.staffCount}</td>
                <td style={{ textAlign: "center" }}>{fmtMoney(c.amountPaise / 100)}</td>
                <td style={{ textAlign: "center" }}>
                  <span className={c.status === "success" ? "hrs-ok" : c.status === "failed" ? "hrs-over" : ""}>
                    {c.status === "would_be" ? "trial (not charged)" : c.status}
                    {c.attemptNumber > 1 ? ` (attempt ${c.attemptNumber})` : ""}
                  </span>
                </td>
                <td style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)" }}>{c.failureReason || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {charges.length === 0 && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>No charges yet.</div>}
      </div>
    </div>
  );
}
