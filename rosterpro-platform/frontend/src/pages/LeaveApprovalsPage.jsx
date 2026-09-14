import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as leaveApi from "../api/leave.js";
import * as holidayApi from "../api/holidays.js";

const STATUS_STYLE = {
  PENDING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  APPROVED: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  REJECTED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  CANCELLED: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
};

const DEFAULT_ENTITLEMENT = { ANNUAL: 30, SICK: 12, CASUAL: 12, MEDICAL: 0, LWP: 0, TRAINING: 0, OTHER: 0 };

function dayCount(fromDate, toDate) {
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

// Leave Approvals — the manager-facing counterpart to the self-service
// "My Leave" page. A Shift Incharge holding only leave:approve_reports (the
// "L1 Manager" role in this app — see seed.js) can genuinely decide leave
// here; a station-wide approver (leave:approve — Station Manager, Airline
// Admin, Super Admin) sees the same queue in read-only oversight by
// default, per the spec's "higher roles must not silently override an L1
// Manager's decision" — they can still act, but only through the explicit
// "Override" confirmation below, never the plain Approve/Reject buttons.
export default function LeaveApprovalsPage() {
  const { user, hasPermission } = useAuth();
  const { currentStation } = useStation();
  const [tab, setTab] = useState("pending");

  const isL1Manager = hasPermission("leave", "approve_reports") && !hasPermission("leave", "approve");

  usePageHeader({
    title: "Leave Approvals",
    subtitle: currentStation ? `${currentStation.name} Line Maintenance${isL1Manager ? " — your direct reports" : ""}` : "",
  });

  return (
    <div>
      <div className="sh">
        <div style={{ display: "flex", gap: 7 }}>
          {[
            ["pending", "Pending Approvals"],
            ["all", "All Team Requests"],
            ["calendar", "Team Calendar"],
            ["holidays", "Holidays"],
          ].map(([key, label]) => (
            <button
              key={key} className="btn btn-ghost"
              style={tab === key ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "pending" && <RequestsTab status="PENDING" isL1Manager={isL1Manager} actorId={user?.id} />}
      {tab === "all" && <RequestsTab status="ALL" isL1Manager={isL1Manager} actorId={user?.id} />}
      {tab === "calendar" && <TeamCalendarTab />}
      {tab === "holidays" && <HolidaysTab canManage={hasPermission("holiday", "manage")} />}
    </div>
  );
}

function RequestsTab({ status, isL1Manager, actorId }) {
  const [items, setItems] = useState(null);
  const [balances, setBalances] = useState({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    // Deliberately no stationId/userId here — the backend already resolves
    // exactly the right scope for the caller (reportsToId-only for an L1
    // Manager, whole station for a broader approver) in GET /api/leave;
    // duplicating that logic client-side would risk it drifting out of
    // sync with the real security boundary.
    leaveApi.listLeave({ status: status === "ALL" ? undefined : status, pageSize: 200 })
      .then(d => setItems(d.items))
      .catch(err => setError(err.message));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  // Balance-after-approval preview (spec #9) — one balance lookup per
  // distinct requester currently in view, not per row.
  useEffect(() => {
    if (!items) return;
    const year = new Date().getFullYear();
    const uniqueUserIds = [...new Set(items.filter(l => l.status === "PENDING").map(l => l.userId))];
    uniqueUserIds.forEach(uid => {
      if (balances[uid]) return;
      leaveApi.getLeaveBalance(uid, year).then(b => setBalances(prev => ({ ...prev, [uid]: b.balance }))).catch(() => {});
    });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id, decision) {
    let reason;
    if (decision === "REJECTED") {
      reason = prompt("Comment (required when rejecting):");
      if (!reason || !reason.trim()) { alert("A comment is required to reject a leave request."); return; }
    }
    try {
      await leaveApi.decideLeave(id, decision, reason);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  async function overrideDecide(id, decision) {
    if (!confirm(
      "This overrides the assigned L1 Manager's decision authority for this request — it does not normally belong to your role. Continue?"
    )) return;
    decide(id, decision);
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!items) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No leave requests match this filter.</div>
      ) : (
        <table className="rt" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Staff</th>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Status</th>
              <th>Balance After</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(l => {
              const days = dayCount(l.fromDate, l.toDate);
              const bal = balances[l.userId]?.[l.leaveType];
              const entitlement = bal?.entitlement ?? DEFAULT_ENTITLEMENT[l.leaveType] ?? 0;
              const remainingNow = bal?.remaining ?? entitlement;
              const remainingAfter = Math.max(0, remainingNow - days);
              return (
                <tr key={l.id}>
                  <td style={{ textAlign: "left", padding: "6px 4px" }}>{l.user?.fullName}</td>
                  <td>{l.leaveType}</td>
                  <td>{new Date(l.fromDate).toISOString().slice(0, 10)}</td>
                  <td>{new Date(l.toDate).toISOString().slice(0, 10)}</td>
                  <td>{days}</td>
                  <td><span className="tag" style={STATUS_STYLE[l.status]}>{l.status}</span></td>
                  <td style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    {l.status === "PENDING" && entitlement > 0 ? `${remainingAfter} / ${entitlement}` : "—"}
                  </td>
                  <td>
                    {l.status === "PENDING" && l.userId !== actorId && (
                      isL1Manager ? (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => decide(l.id, "APPROVED")}>✅ Approve</button>
                          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => decide(l.id, "REJECTED")}>✕ Reject</button>
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => overrideDecide(l.id, "APPROVED")} title="Read-only oversight by default — this is a deliberate override">
                          ⚠ Override…
                        </button>
                      )
                    )}
                    {l.status !== "PENDING" && l.approvedBy && (
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                        by {l.approvedBy.fullName}{l.comment ? ` — "${l.comment}"` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Rolling 30-day visual window: one row per staff member who has
// pending/approved leave in range, one cell per day, colored by status —
// enough to spot overlaps before approving without needing a full roster-
// grid-style component for what is fundamentally a much simpler picture.
function TeamCalendarTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const days = useMemo(() => {
    const out = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  useEffect(() => {
    const from = days[0].toISOString().slice(0, 10);
    const to = days[days.length - 1].toISOString().slice(0, 10);
    leaveApi.getTeamCalendar({ from, to })
      .then(d => setItems(d.items))
      .catch(err => setError(err.message));
  }, [days]);

  if (error) return <div className="ab red">{error}</div>;
  if (!items) return <div className="card">Loading…</div>;

  const byStaff = {};
  for (const l of items) {
    (byStaff[l.user?.fullName || l.userId] ??= []).push(l);
  }
  const staffNames = Object.keys(byStaff).sort();

  return (
    <div className="card">
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10, display: "flex", gap: 14 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--amber)", borderRadius: 2, marginRight: 4 }} />Pending</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--rp-green)", borderRadius: 2, marginRight: 4 }} />Approved</span>
      </div>
      {staffNames.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No pending or approved leave for your team in the next 30 days.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="rt" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}>Staff</th>
                {days.map(d => (
                  <th key={d.toISOString()} style={{ fontSize: 9, minWidth: 20 }}>{d.getUTCDate()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffNames.map(name => (
                <tr key={name}>
                  <td style={{ textAlign: "left", fontSize: 11, position: "sticky", left: 0, background: "var(--surface)", whiteSpace: "nowrap" }}>{name}</td>
                  {days.map(d => {
                    const onLeave = byStaff[name].find(l => new Date(l.fromDate) <= d && d <= new Date(l.toDate));
                    return (
                      <td key={d.toISOString()} style={{ padding: 1 }}>
                        <div
                          title={onLeave ? `${onLeave.leaveType} (${onLeave.status})` : ""}
                          style={{
                            height: 16, borderRadius: 2,
                            background: onLeave ? (onLeave.status === "PENDING" ? "var(--amber)" : "var(--rp-green)") : "var(--navy-lite)",
                            opacity: onLeave ? 0.85 : 0.3,
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HolidaysTab({ canManage }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    holidayApi.listHolidays({ pageSize: 100 }).then(d => setItems(d.items)).catch(err => setError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addHoliday() {
    if (!name.trim() || !date) { setError("Name and date are required"); return; }
    setBusy(true);
    setError("");
    try {
      await holidayApi.createHoliday({ name: name.trim(), date });
      setName(""); setDate("");
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function removeHoliday(id) {
    if (!confirm("Remove this holiday?")) return;
    try { await holidayApi.deleteHoliday(id); load(); } catch (err) { alert(`Failed: ${err.message}`); }
  }

  return (
    <div className="card">
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
        Informational only for now — holidays are shown here and on the calendar, but do not change roster generation or staffing targets.
      </div>
      {error && <div className="ab red">{error}</div>}
      {canManage && (
        <div className="fg2" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div className="fg"><label className="fl">Name</label><input className="fi" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fg"><label className="fl">Date</label><input className="fi" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <button className="btn btn-primary btn-sm" onClick={addHoliday} disabled={busy}>＋ Add Holiday</button>
        </div>
      )}
      {!items ? <div>Loading…</div> : items.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No holidays configured.</div>
      ) : (
        <table className="rt" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Date</th><th style={{ textAlign: "left" }}>Name</th><th>Scope</th>{canManage && <th>Actions</th>}</tr></thead>
          <tbody>
            {items.map(h => (
              <tr key={h.id}>
                <td style={{ textAlign: "left" }}>{new Date(h.date).toISOString().slice(0, 10)}</td>
                <td style={{ textAlign: "left" }}>{h.name}</td>
                <td>{h.stationId ? h.station?.iataCode || "This station" : "Airline-wide"}</td>
                {canManage && <td><button className="btn btn-ghost btn-sm" onClick={() => removeHoliday(h.id)}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
