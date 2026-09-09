import { useState } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { requestAccountDeletion } from "../api/auth.js";

// Self-service "right to erasure" entry point. This never deletes anything
// itself — a technician's account is also aviation maintenance work history
// (who performed/witnessed what, when) that the airline may be legally
// required to retain, and the backend's own hard-delete already refuses
// to remove anyone with that kind of history attached. So this just files
// the request (audit-logged, station admins notified) for a human to
// action via Staff Registry once any retention requirement is cleared —
// never an instant, unreviewed self-delete of real records.
export default function MyAccountPage() {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState(null); // null | "sending" | "sent" | "error"

  usePageHeader({ title: "My Account", subtitle: "Your profile and data privacy options" });

  async function submitDeletionRequest() {
    setStatus("sending");
    try {
      await requestAccountDeletion(reason.trim());
      setStatus("sent");
      setConfirming(false);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Profile</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, fontSize: 13 }}>
          <Row label="Name" value={user?.fullName} />
          <Row label="Email" value={user?.email} />
          <Row label="Designation" value={user?.designation} />
          <Row label="Station" value={user?.station?.name} />
          <Row label="Roles" value={user?.roles?.join(", ")} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Privacy &amp; data</div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
          You can request that your RosterPro account and personal data be deleted.
          Your station's admin will review the request — your qualification, license,
          and duty history may need to be retained for a period if it's part of the
          airline's maintenance records, in which case your account will be deactivated
          (hidden from future scheduling) rather than erased outright.
        </p>

        {status === "sent" ? (
          <div className="alert-card" style={{ marginTop: 10, background: "rgba(0,200,83,.1)", color: "var(--rp-green)" }}>
            <span>✓</span>
            <div>
              <div className="alert-card-title">Request sent</div>
              <div className="alert-card-sub">Your station admin has been notified.</div>
            </div>
          </div>
        ) : !confirming ? (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setConfirming(true)}>
            Request account deletion
          </button>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              className="fi"
              rows={3}
              placeholder="Reason (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            {status === "error" && <div className="ab red">Could not send the request. Try again.</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={status === "sending"} onClick={submitDeletionRequest}>
                {status === "sending" ? "Sending…" : "Confirm request"}
              </button>
              <button className="btn btn-ghost" onClick={() => { setConfirming(false); setStatus(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
