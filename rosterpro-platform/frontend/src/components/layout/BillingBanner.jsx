import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";
import * as billingApi from "../../api/billing.js";

const TRIAL_WARNING_DAYS = 14;

// Persistent, impossible-to-miss — mounted once in AppLayout so it's on
// every authenticated page, not just the Billing page. Visible to every
// role at the airline (not just Airline Admin): read-only blocks
// everyone's writes, so everyone needs to know why, even though only an
// Airline Admin can actually fix it (see the conditional CTA below).
export default function BillingBanner() {
  const { isAuthenticated, hasPermission } = useAuth();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    billingApi.getBillingStatus().then(setStatus).catch(() => {}); // SUPER_ADMIN (no airlineId) 400s here — silently no banner, expected
  }, [isAuthenticated]);

  if (!status) return null;

  const canManage = hasPermission("billing", "manage");
  const cta = canManage
    ? <Link to="/billing" style={{ color: "inherit", fontWeight: 800, textDecoration: "underline", marginLeft: 6 }}>Add a payment method →</Link>
    : <span style={{ marginLeft: 6, opacity: 0.85 }}>Contact your Airline Admin to resolve this.</span>;

  if (status.status === "read_only" || status.status === "cancelled") {
    return (
      <div className="ab red" style={{ margin: "0 14px", borderRadius: 0 }}>
        🔒 This account is <strong>read-only</strong> — viewing works normally, but creating, editing, or deleting anything is blocked until a payment method is added.{cta}
      </div>
    );
  }

  if (status.status === "trialing" && !status.hasPaymentMethod && status.daysUntilTrialEnd !== null && status.daysUntilTrialEnd <= TRIAL_WARNING_DAYS) {
    const days = Math.max(status.daysUntilTrialEnd, 0);
    return (
      <div className="ab amber" style={{ margin: "0 14px", borderRadius: 0 }}>
        ⏳ Your free trial {days === 0 ? "ends today" : `ends in ${days} day${days === 1 ? "" : "s"}`} — after that, this account becomes read-only until a payment method is added.{cta}
      </div>
    );
  }

  return null;
}
