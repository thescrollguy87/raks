import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as leaveApi from "../api/leave.js";
import RequestLeaveModal from "../components/leave/RequestLeaveModal.jsx";

const STATUS_STYLE = {
  PENDING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  APPROVED: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  REJECTED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  CANCELLED: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
};

// This page is deliberately "My Leave" — the logged-in person's own
// requests only. It was previously querying by station (showing everyone's
// requests mixed together, with no userId filter at all) which is both a
// privacy leak and the root of the "No leave requests match this filter"
// bug reported against this exact screen: always scoping to the caller's
// own userId is what makes the filter tabs (and this page's very purpose,
// "your history") actually correct. Approving/rejecting someone ELSE's
// request now lives on the separate Leave Approvals page, scoped to a
// manager's real direct reports — never mixed into this self-service view.
export default function LeavePage() {
  const { user } = useAuth();
  const { currentStation } = useStation();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [leaves, setLeaves] = useState(null);
  const [balance, setBalance] = useState(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [error, setError] = useState("");

  // Memoized: usePageHeader re-syncs whenever `actions` changes reference,
  // and this component re-renders on every header-context update — a fresh
  // JSX element here every render would loop the two forever.
  const headerActions = useMemo(() => (
    <button className="btn btn-primary" onClick={() => setShowRequestModal(true)}>＋ Apply for Leave</button>
  ), []);

  usePageHeader({
    title: "My Leave",
    subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "",
    actions: headerActions,
  });

  const load = useCallback(() => {
    if (!user?.id) return;
    setError("");
    leaveApi.listLeave({ userId: user.id, status: statusFilter === "ALL" ? undefined : statusFilter, pageSize: 100 })
      .then(d => setLeaves(d))
      .catch(err => setError(err.message));
    leaveApi.getLeaveBalance(user.id, new Date().getFullYear())
      .then(setBalance)
      .catch(() => {}); // balance is a nice-to-have widget; don't block the page on it
  }, [statusFilter, user]);

  useEffect(() => { load(); }, [load]);

  async function handleCancel(id) {
    if (!confirm("Cancel this leave request?")) return;
    try {
      await leaveApi.cancelLeave(id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  return (
    <div>
      {balance && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-title">Your Leave Balance ({new Date().getFullYear()})</div>
          <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
            {Object.entries(balance.balance).filter(([, v]) => v.entitlement > 0).map(([type, v]) => (
              <div key={type} style={{ fontSize: 11, minWidth: 110 }}>
                <div style={{ color: "var(--text-dim)", fontWeight: 700 }}>{type}</div>
                <div>{v.remaining} / {v.entitlement} remaining</div>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, (v.remaining / v.entitlement) * 100)}%`, background: v.remaining === 0 ? "var(--rp-red)" : "var(--cyan)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sh">
        <div className="st">Your Requests</div>
        <div style={{ display: "flex", gap: 7 }}>
          {["PENDING", "APPROVED", "REJECTED", "ALL"].map(s => (
            <button
              key={s} className="btn btn-ghost"
              style={statusFilter === s ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined}
              onClick={() => setStatusFilter(s)}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="ab red">{error}</div>}

      <div className="card">
        {!leaves ? (
          <div>Loading…</div>
        ) : leaves.items.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No leave requests match this filter.</div>
        ) : (
          <table className="rt" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th style={{ textAlign: "left" }}>Decided By</th>
                <th style={{ textAlign: "left" }}>Comment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leaves.items.map(l => (
                <tr key={l.id}>
                  <td style={{ textAlign: "left", padding: "6px 4px" }}>{l.leaveType}</td>
                  <td>{new Date(l.fromDate).toISOString().slice(0, 10)}</td>
                  <td>{new Date(l.toDate).toISOString().slice(0, 10)}</td>
                  <td><span className="tag" style={STATUS_STYLE[l.status]}>{l.status}</span></td>
                  <td style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)" }}>
                    {l.approvedBy
                      ? `${l.approvedBy.fullName}${l.approvedBy.roles?.[0]?.role?.name ? ` (${l.approvedBy.roles[0].role.name})` : ""}`
                      : "—"}
                  </td>
                  <td style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)" }}>{l.comment || "—"}</td>
                  <td>
                    {(l.status === "PENDING" || l.status === "APPROVED") && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleCancel(l.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showRequestModal && <RequestLeaveModal onSaved={load} onClose={() => setShowRequestModal(false)} />}
    </div>
  );
}
