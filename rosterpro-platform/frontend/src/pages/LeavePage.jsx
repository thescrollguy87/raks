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

const LEAVE_TYPES = ["ANNUAL", "SICK", "CASUAL", "MEDICAL", "LWP", "TRAINING", "OTHER"];
const DEFAULT_ENTITLEMENT = { ANNUAL: 30, SICK: 12, CASUAL: 12, MEDICAL: 0, LWP: 0, TRAINING: 0, OTHER: 0 };

const ROLE_LABELS = {
  SHIFT_INCHARGE: "L1 Manager", STATION_MANAGER: "Station Manager", AIRLINE_ADMIN: "Airline Admin",
  LMM: "Line Maintenance Manager", SUPER_ADMIN: "Super Admin", READ_ONLY_AUDITOR: "Auditor",
};
function roleLabel(name) {
  if (!name) return "";
  return ROLE_LABELS[name] || name.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function dayCount(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  return Math.max(0, Math.round(ms / 86400000) + 1);
}

// Leave & Absence — one page, one Leave record everywhere it's read or
// written. "My Leave" always shows the logged-in person's own history
// (always scoped by userId, which is what actually fixes the old "No leave
// requests match this filter" bug — this page used to query by station
// with no userId filter at all). If the caller can also approve leave
// (leave:approve_reports — the "L1 Manager" role in this app, see seed.js
// — or the station-wide leave:approve), their team's Approvals queue and
// Team Calendar preview render right below their own requests, plus full
// dedicated tabs for a focused view.
export default function LeavePage() {
  const { user, hasPermission } = useAuth();
  const { currentStation } = useStation();
  const [tab, setTab] = useState("myleave");

  const isL1Manager = hasPermission("leave", "approve_reports") && !hasPermission("leave", "approve");
  const canApproveAny = isL1Manager || hasPermission("leave", "approve");
  const canManageHolidays = hasPermission("holiday", "manage");

  const [myLeaves, setMyLeaves] = useState(null);
  const [balance, setBalance] = useState(null);
  const [approvals, setApprovals] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [error, setError] = useState("");

  const myRoleLabel = isL1Manager ? "L1 Manager" : roleLabel(user?.roles?.[0]);

  usePageHeader({
    title: "Leave & Absence",
    subtitle: currentStation
      ? `${currentStation.name} Line Maintenance · Signed in as ${user?.fullName || "—"}${myRoleLabel ? `, ${myRoleLabel}` : ""}`
      : "",
  });

  const loadMine = useCallback(() => {
    if (!user?.id) return;
    setError("");
    leaveApi.listLeave({ userId: user.id, pageSize: 100 }).then(setMyLeaves).catch(err => setError(err.message));
    leaveApi.getLeaveBalance(user.id, new Date().getFullYear()).then(setBalance).catch(() => {});
  }, [user]);

  // No stationId/reportsToId passed here on purpose — GET /api/leave
  // already resolves exactly the right scope server-side (reportsToId-only
  // for an L1 Manager, whole station for a broader approver); duplicating
  // that logic client-side would risk drifting out of sync with the real
  // security boundary.
  const loadApprovals = useCallback(() => {
    if (!canApproveAny) return;
    leaveApi.listLeave({ pageSize: 100 }).then(d => setApprovals(d.items)).catch(err => setError(err.message));
  }, [canApproveAny]);

  const loadHolidays = useCallback(() => {
    holidayApi.listHolidays({ pageSize: 100 }).then(d => setHolidays(d.items)).catch(() => {});
  }, []);

  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { loadApprovals(); }, [loadApprovals]);
  useEffect(() => { loadHolidays(); }, [loadHolidays]);

  async function handleCancel(id) {
    if (!confirm("Cancel this leave request?")) return;
    try {
      await leaveApi.cancelLeave(id);
      loadMine();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }

  async function decide(id, decision) {
    let reason;
    if (decision === "REJECTED") {
      reason = prompt("Comment (required when rejecting):");
      if (!reason || !reason.trim()) { alert("A comment is required to reject a leave request."); return; }
    }
    try {
      await leaveApi.decideLeave(id, decision, reason);
      loadApprovals();
      loadMine();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }

  async function overrideDecide(id, decision) {
    if (!confirm("This overrides the assigned L1 Manager's decision authority for this request — it does not normally belong to your role. Continue?")) return;
    decide(id, decision);
  }

  const pendingApprovals = useMemo(() => (approvals || []).filter(l => l.status === "PENDING"), [approvals]);

  return (
    <div>
      <div className="sh">
        <div style={{ display: "flex", gap: 7 }}>
          {[
            ["myleave", "My Leave", null],
            canApproveAny ? ["approvals", "Approvals", pendingApprovals.length] : null,
            canApproveAny ? ["calendar", "Team Calendar", null] : null,
            ["holidays", "Holidays", null],
          ].filter(Boolean).map(([key, label, count]) => (
            <button
              key={key} className="btn btn-ghost"
              style={tab === key ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined}
              onClick={() => setTab(key)}
            >
              {label}{!!count && <span className="ni-badge" style={{ marginLeft: 6 }}>{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="ab red">{error}</div>}

      {tab === "myleave" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, alignItems: "start" }}>
          <div>
            <BalanceCards balance={balance} />
            <RequestsCard leaves={myLeaves} onCancel={handleCancel} />
            {isL1Manager && (
              <ApprovalsCard
                title="Approvals — your team" subtitle="Requests from staff reporting to you. Approving or rejecting updates the request immediately for the requester, and is visible to your Station Manager, Airline Admin, and Super Admin."
                items={pendingApprovals} highlight onDecide={decide}
              />
            )}
            {!isL1Manager && canApproveAny && pendingApprovals.length > 0 && (
              <ApprovalsCard
                title="Approvals — your station" subtitle="Read-only by default — an L1 Manager owns these decisions. Overriding is a separate, deliberate action."
                items={pendingApprovals} onOverride={overrideDecide}
              />
            )}
            {canApproveAny && <TeamCalendarCard days={14} title="Team leave — next 14 days" />}
          </div>

          <div>
            <ApplyForm onSubmitted={loadMine} />
            <UpcomingHolidays holidays={holidays} />
          </div>
        </div>
      )}

      {tab === "approvals" && canApproveAny && (
        <ApprovalsCard
          title={isL1Manager ? "Approvals — your team" : "Approvals — your station"}
          items={approvals || []} showAll
          highlight={isL1Manager}
          onDecide={isL1Manager ? decide : undefined}
          onOverride={!isL1Manager ? overrideDecide : undefined}
        />
      )}

      {tab === "calendar" && canApproveAny && <TeamCalendarCard days={30} title="Team leave — next 30 days" />}

      {tab === "holidays" && <HolidaysCard holidays={holidays} canManage={canManageHolidays} onChanged={loadHolidays} />}
    </div>
  );
}

function BalanceCards({ balance }) {
  if (!balance) return null;
  const entries = Object.entries(balance.balance).filter(([, v]) => v.entitlement > 0);
  if (!entries.length) return null;
  return (
    <div className="card">
      <div className="card-title">Your Leave Balance — {balance.year}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${entries.length}, 1fr)`, gap: 14 }}>
        {entries.map(([type, v]) => (
          <div key={type}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600, marginBottom: 2 }}>
              {type.charAt(0) + type.slice(1).toLowerCase()}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {v.remaining}<span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-dim)" }}> / {v.entitlement} remaining</span>
            </div>
            <div className="progress" style={{ marginTop: 6 }}>
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (v.remaining / v.entitlement) * 100)}%`, background: v.remaining === 0 ? "var(--rp-red)" : "var(--cyan)" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestsCard({ leaves, onCancel }) {
  const [filter, setFilter] = useState("ALL");
  const items = useMemo(() => {
    if (!leaves) return null;
    return filter === "ALL" ? leaves.items : leaves.items.filter(l => l.status === filter);
  }, [leaves, filter]);

  return (
    <div className="card">
      <div className="sh" style={{ marginBottom: 4 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>Your Requests</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Every request you've made, its current status, and who acted on it.</div>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {["PENDING", "APPROVED", "REJECTED", "ALL"].map(s => (
            <button
              key={s} className="btn btn-ghost btn-sm"
              style={filter === s ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined}
              onClick={() => setFilter(s)}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {!items ? (
        <div>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "6px 2px" }}>No leave requests match this filter.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {items.map(l => (
            <div key={l.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{l.leaveType.charAt(0) + l.leaveType.slice(1).toLowerCase()} Leave</div>
                <span className="tag" style={STATUS_STYLE[l.status]}>{l.status}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                {fmtDate(l.fromDate)} – {fmtDate(l.toDate)} · {dayCount(l.fromDate, l.toDate)} days
              </div>

              {l.status === "PENDING" ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>
                    Submitted {fmtDate(l.createdAt)} — awaiting your L1 Manager
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => onCancel(l.id)}>Cancel Request</button>
                </div>
              ) : (l.status === "APPROVED" || l.status === "REJECTED") && l.approvedBy ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 10, color: "var(--text-dim)" }}>
                  {l.status === "APPROVED" ? "Approved" : "Rejected"} by {l.approvedBy.fullName}
                  {l.approvedBy.roles?.[0]?.role?.name ? ` (${roleLabel(l.approvedBy.roles[0].role.name)})` : ""} on {fmtDate(l.approvedAt)}
                  {l.comment ? ` — "${l.comment}"` : ""}
                  {l.status === "APPROVED" && (
                    <div style={{ marginTop: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onCancel(l.id)}>Cancel Request</button>
                    </div>
                  )}
                </div>
              ) : l.status === "CANCELLED" ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 10, color: "var(--text-dim)" }}>
                  Cancelled on {fmtDate(l.updatedAt)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplyForm({ onSubmitted }) {
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const days = dayCount(fromDate, toDate);

  async function submit() {
    if (!fromDate || !toDate) { setError("From and To dates are required"); return; }
    setSaving(true);
    setError("");
    try {
      await leaveApi.requestLeave({ leaveType, fromDate, toDate });
      setFromDate(""); setToDate("");
      onSubmitted();
    } catch (err) {
      setError(err.message || "Failed to submit leave request");
    } finally { setSaving(false); }
  }

  return (
    <div className="card">
      <div className="card-title">Apply for Leave</div>
      {error && <div className="ab red" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="fg" style={{ marginBottom: 10 }}>
        <label className="fl">Leave Type</label>
        <select className="fi" value={leaveType} onChange={e => setLeaveType(e.target.value)}>
          {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
        </select>
      </div>
      <div className="fg2" style={{ marginBottom: 10 }}>
        <div className="fg"><label className="fl">From</label><input className="fi" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
        <div className="fg"><label className="fl">To</label><input className="fi" type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
      </div>
      <div className="fg" style={{ marginBottom: 12 }}>
        <label className="fl">Days</label>
        <div className="fi" style={{ background: "transparent", border: "none", padding: "2px 0", fontWeight: 700 }}>
          {days > 0 ? days : "—"}
        </div>
      </div>
      <button className="btn btn-primary" style={{ width: "100%" }} disabled={saving} onClick={submit}>
        {saving ? "Submitting…" : "Submit for Approval"}
      </button>
    </div>
  );
}

function UpcomingHolidays({ holidays }) {
  const upcoming = useMemo(() => {
    if (!holidays) return [];
    const today = isoDay(new Date());
    return holidays.filter(h => isoDay(h.date) >= today).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);
  }, [holidays]);

  return (
    <div className="card">
      <div className="card-title">Upcoming Holidays</div>
      {upcoming.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No upcoming holidays configured.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {upcoming.map(h => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span>{h.name}</span>
              <strong style={{ color: "var(--cyan)" }}>{new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalsCard({ title, subtitle, items, highlight, onDecide, onOverride, showAll }) {
  const visible = showAll ? items : items.filter(l => l.status === "PENDING");
  return (
    <div className="card" style={highlight ? { border: "1px solid rgba(217,119,6,.35)", background: "rgba(217,119,6,.04)" } : undefined}>
      <div className="card-title">{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: -6, marginBottom: 10 }}>{subtitle}</div>}
      {visible.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No requests to show.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map(l => {
            const days = dayCount(l.fromDate, l.toDate);
            return (
              <div key={l.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--navy-mid)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>
                    {l.user?.fullName} <span style={{ fontWeight: 500, color: "var(--text-dim)" }}>· {l.user?.category || ""}</span>
                  </div>
                  <span className="tag" style={STATUS_STYLE[l.status]}>{l.status}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  {l.leaveType.charAt(0) + l.leaveType.slice(1).toLowerCase()} Leave · {fmtDate(l.fromDate)} – {fmtDate(l.toDate)} · {days} day{days === 1 ? "" : "s"}
                </div>
                {l.status === "PENDING" && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Submitted {fmtDate(l.createdAt)}</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {onDecide && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => onDecide(l.id, "APPROVED")}>Approve</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => onDecide(l.id, "REJECTED")}>Reject</button>
                        </>
                      )}
                      {onOverride && <button className="btn btn-ghost btn-sm" onClick={() => onOverride(l.id, "APPROVED")}>⚠ Override…</button>}
                    </div>
                  </div>
                )}
                {l.status !== "PENDING" && l.approvedBy && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-dim)" }}>
                    by {l.approvedBy.fullName}{l.comment ? ` — "${l.comment}"` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamCalendarCard({ days: windowSize, title }) {
  const [items, setItems] = useState(null);

  const days = useMemo(() => {
    const out = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < windowSize; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(d);
    }
    return out;
  }, [windowSize]);

  useEffect(() => {
    leaveApi.getTeamCalendar({ from: isoDay(days[0]), to: isoDay(days[days.length - 1]) })
      .then(d => setItems(d.items))
      .catch(() => setItems([]));
  }, [days]);

  const byStaff = {};
  for (const l of items || []) (byStaff[l.user?.fullName || l.userId] ??= []).push(l);
  const staffNames = Object.keys(byStaff).sort();

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
        Spot overlaps before approving — amber is pending, green is already approved.
      </div>
      {items === null ? (
        <div>Loading…</div>
      ) : staffNames.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No pending or approved leave for your team in this window.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)", position: "sticky", left: 0, background: "var(--navy-mid)", paddingRight: 8 }}>Staff</th>
                {days.map(d => <th key={d.toISOString()} style={{ fontSize: 9, color: "var(--text-dim)", minWidth: 20 }}>{d.getUTCDate()}</th>)}
              </tr>
            </thead>
            <tbody>
              {staffNames.map(name => (
                <tr key={name}>
                  <td style={{ textAlign: "left", fontSize: 11, fontWeight: 600, position: "sticky", left: 0, background: "var(--navy-mid)", whiteSpace: "nowrap", paddingRight: 8 }}>{name}</td>
                  {days.map(d => {
                    const onLeave = byStaff[name].find(l => new Date(l.fromDate) <= d && d <= new Date(l.toDate));
                    return (
                      <td key={d.toISOString()} style={{ padding: 1 }}>
                        <div
                          title={onLeave ? `${onLeave.leaveType} (${onLeave.status})` : ""}
                          style={{
                            height: 16, borderRadius: 2,
                            background: onLeave ? (onLeave.status === "PENDING" ? "var(--amber)" : "var(--rp-green)") : "var(--navy-lite)",
                            opacity: onLeave ? 0.9 : 0.5,
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

function HolidaysCard({ holidays, canManage, onChanged }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addHoliday() {
    if (!name.trim() || !date) { setError("Name and date are required"); return; }
    setBusy(true);
    setError("");
    try {
      await holidayApi.createHoliday({ name: name.trim(), date });
      setName(""); setDate("");
      onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function removeHoliday(id) {
    if (!confirm("Remove this holiday?")) return;
    try { await holidayApi.deleteHoliday(id); onChanged(); } catch (err) { alert(`Failed: ${err.message}`); }
  }

  return (
    <div className="card">
      <div className="card-title">Holidays</div>
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
      {!holidays ? <div>Loading…</div> : holidays.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No holidays configured.</div>
      ) : (
        <table className="rt" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Date</th><th style={{ textAlign: "left" }}>Name</th><th>Scope</th>{canManage && <th>Actions</th>}</tr></thead>
          <tbody>
            {holidays.map(h => (
              <tr key={h.id}>
                <td style={{ textAlign: "left" }}>{fmtDate(h.date)}</td>
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
