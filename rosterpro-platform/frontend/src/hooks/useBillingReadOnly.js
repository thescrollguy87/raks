import { useEffect, useState } from "react";
import { useAuth } from "../store/AuthContext.jsx";
import * as billingApi from "../api/billing.js";

// Cheap client-side mirror of the backend's read-only gate (see
// middleware/billingGate.js) — the backend is always the real enforcement
// point (a write is rejected there regardless of what this hook says), but
// a page that does real writes should be able to disable its own buttons
// and show a clear reason up front, rather than let the user click Save
// and only then see a 402. Not exhaustively wired into every write control
// in the app — see BillingBanner.jsx for the always-present, unmissable
// notice; this hook is for individual pages that want to go further.
export function useBillingReadOnly() {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    billingApi.getBillingStatus().then(setStatus).catch(() => {});
  }, [isAuthenticated]);

  const isReadOnly = status?.status === "read_only" || status?.status === "cancelled";
  return { isReadOnly, status };
}
