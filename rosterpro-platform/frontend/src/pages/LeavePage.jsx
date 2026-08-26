import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as leaveApi from "../api/leave.js";
import RequestLeaveModal from "../components/leave/RequestLeaveModal.jsx";

const STATUS_STYLE = {
  PENDING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  APPROVED: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  REJECTED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  CANCELLED: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
};

export default function LeavePage() {
  const { user, hasPermission } = useAuth();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [leaves, setLeaves] = useState(null);
  const [balance, setBalance] = useState(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [error, setError] = useState("");

  const canApprove = hasPermission("leave", "approve");

  usePageHeader({
    title: "Leave & Absence",
    subtitle: "AMD Line Maintenance",
    actions: <button className="btn btn-primary" onClick={() => setShowRequestModal(true)}>＋ Request Leave</button>,
  });

  const load = useCallback(() => {
    setError("");
    leaveApi.listLeave({ status: statusFilter === "ALL" ? undefined : statusFilter, pageSize: 100 })
      .then(d => setLeaves(d))
      .catch(err => setError(err.message));
    leaveApi.getLeaveBalance(user?.id, new Date().getFullYear())
      .then(setBalance)
      .catch(() => {}); // balance is a nice-to-have widget; don't block the page on it
  }, [statusFilter, user]);

  useEffect(() => { load(); }, [load]);

  async function handleDecide(id, decision) {
    const reason = decision === "REJECTED" ? prompt("Reason for rejecting (optional):") || undefined : undefined;
    try {
      await leaveApi.decideLeave(id, decision, reason);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

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
              <div key={type} style={{ fontSize: 11 }}>
                <div style={{ color: "var(--text-dim)", fontWeight: 700 }}>{type}</div>
                <div>{v.remaining} / {v.entitlement} remaining</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sh">
        <div className="st">Leave Requests</div>
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
                <th style={{ textAlign: "left" }}>Staff</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leaves.items.map(l => (
                <tr key={l.id}>
                  <td style={{ textAlign: "left", padding: "6px 4px" }}>{l.user?.fullName}</td>
                  <td>{l.leaveType}</td>
                  <td>{new Date(l.fromDate).toISOString().slice(0, 10)}</td>
                  <td>{new Date(l.toDate).toISOString().slice(0, 10)}</td>
                  <td><span className="tag" style={STATUS_STYLE[l.status]}>{l.status}</span></td>
                  <td>
                    {l.status === "PENDING" && canApprove && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDecide(l.id, "APPROVED")}>✅ Approve</button>
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => handleDecide(l.id, "REJECTED")}>✕ Reject</button>
                      </>
                    )}
                    {(l.status === "PENDING" || l.status === "APPROVED") && l.userId === user?.id && (
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
