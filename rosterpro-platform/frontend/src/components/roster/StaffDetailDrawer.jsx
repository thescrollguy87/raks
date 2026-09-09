import { useState, useEffect, useMemo } from "react";
import { getComplianceSummary } from "../../api/compliance.js";
import { listLeave } from "../../api/leave.js";
import { shiftNetHours, effectiveShiftWindow, restGapHours } from "../../utils/shiftHours.js";

const TABS = ["Overview", "Leave", "Qualifications", "History"];

// Everything on the Overview tab is computed from data the roster grid
// already has loaded for this month (staff.shiftAssignments) — no extra
// network round trip. Leave and Qualifications each cost exactly one API
// call, made only once, when the drawer opens for this one staff member —
// never a bulk fetch across the whole roster.
export default function StaffDetailDrawer({ staff, monthKey, nDays, shiftDefByCode, onClose, onEditToday }) {
  const [tab, setTab] = useState("Overview");
  const [compliance, setCompliance] = useState(null);
  const [leaves, setLeaves] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCompliance(null);
    setLeaves(null);
    setLoadErr("");
    Promise.all([
      getComplianceSummary(staff.id).catch(() => null),
      listLeave({ userId: staff.id, status: "APPROVED", pageSize: 50 }).catch(() => null),
    ]).then(([comp, leaveRes]) => {
      if (cancelled) return;
      setCompliance(comp);
      setLeaves(Array.isArray(leaveRes) ? leaveRes : leaveRes?.items || []);
    });
    return () => { cancelled = true; };
  }, [staff.id]);

  const assignmentsByDay = useMemo(() => {
    return Array.from({ length: nDays }, (_, i) => {
      const day = i + 1;
      const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
      return { day, dateStr, a: staff.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr) };
    });
  }, [staff, monthKey, nDays]);

  const overview = useMemo(() => {
    let morning = 0, afternoon = 0, night = 0, leave = 0, off = 0, totalHours = 0;
    const restViolations = [];
    let prevWindow = null; // effectiveShiftWindow() result for the previous day worked
    for (const { dateStr, a } of assignmentsByDay) {
      const code = a?.shiftDef.code || "O";
      const def = shiftDefByCode[code];
      if (def?.type === "night") night++;
      else if (code[0] === "M") morning++;
      else if (code[0] === "A") afternoon++;
      else if (def?.type === "leave") leave++;
      else if (code === "O" || def?.type === "off") off++;
      totalHours += shiftNetHours(def, a);

      const in1 = a?.in1 || def?.startTime;
      if (prevWindow && in1) {
        const gapHours = restGapHours(prevWindow, dateStr, in1);
        if (gapHours !== null && gapHours < 12) {
          restViolations.push({ dateStr, gapHours });
        }
      }
      prevWindow = effectiveShiftWindow(def, a, dateStr);
    }
    const totalDuties = morning + afternoon + night;
    return { morning, afternoon, night, leave, off, totalDuties, totalHours, restViolations };
  }, [assignmentsByDay, shiftDefByCode]);

  const today = staff.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === todayISO());
  const isOnLeaveToday = today && shiftDefByCode[today.shiftDef.code]?.type === "leave";

  // "Recent" means most-recent-up-to-today when viewing the current month
  // (never a future-scheduled day later in the month) — for a past or
  // future month, there's no "today" boundary inside it, so just show the
  // whole month's list, most recent day first.
  const isCurrentMonth = monthKey === todayISO().slice(0, 7);
  const todayDayNum = isCurrentMonth ? Number(todayISO().slice(8, 10)) : null;
  const recentDuties = [...assignmentsByDay]
    .filter(x => todayDayNum === null || x.day <= todayDayNum)
    .reverse().filter(x => x.a).slice(0, tab === "History" ? 30 : 5);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-hdr">
          <div className="drawer-avatar">{initials(staff.fullName)}</div>
          <div>
            <div className="drawer-name">{staff.fullName.split("(")[0].trim()}</div>
            <div className="drawer-role">{staff.designation} • {staff.category || "NCS"}</div>
            <div className="drawer-avail">
              <span className={`avail-dot ${isOnLeaveToday ? "amber" : "green"}`} />
              {isOnLeaveToday ? "On Leave Today" : "Available"}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "10px 18px 0" }}>
          <div className="tab-strip" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: "none" }}>
            {TABS.map(t => (
              <button key={t} className={`tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="drawer-body">
          {tab === "Overview" && (
            <>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Total Duties</span><span className="drawer-metric-val">{overview.totalDuties}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Morning</span><span className="drawer-metric-val">{overview.morning}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Afternoon</span><span className="drawer-metric-val">{overview.afternoon}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Night</span><span className="drawer-metric-val">{overview.night}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Leaves</span><span className="drawer-metric-val">{overview.leave}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Off Days</span><span className="drawer-metric-val">{overview.off}</span></div>
              <div className="drawer-metric-row"><span className="drawer-metric-label">Total Hours (est.)</span><span className="drawer-metric-val">{overview.totalHours.toFixed(1)}h</span></div>
              <div className="drawer-metric-row">
                <span className="drawer-metric-label">Rest Violations</span>
                <span className={`metric-badge ${overview.restViolations.length ? "red" : "neutral"}`}>{overview.restViolations.length}</span>
              </div>
              <div className="drawer-metric-row">
                <span className="drawer-metric-label">Qualification Issues</span>
                <span className={`metric-badge ${compliance?.isBlocked ? "red" : compliance ? "neutral" : "neutral"}`}>
                  {compliance ? (compliance.isBlocked ? "Blocked" : 0) : "…"}
                </span>
              </div>

              {overview.restViolations.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                  {overview.restViolations.slice(0, 3).map((v, i) => (
                    <div key={i} className="alert-card amber">
                      <span>⚠</span>
                      <div>
                        <div className="alert-card-title">{v.dateStr}</div>
                        <div className="alert-card-sub">Only {v.gapHours.toFixed(1)}h rest before this shift (below 12h)</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="card-title" style={{ marginTop: 16 }}>Recent Duties</div>
              {recentDuties.length === 0 && <div className="empty-note">No duties recorded this month.</div>}
              {recentDuties.map(({ dateStr, a }) => (
                <DutyRow key={dateStr} dateStr={dateStr} code={a.shiftDef.code} def={shiftDefByCode[a.shiftDef.code]} a={a} />
              ))}
            </>
          )}

          {tab === "History" && (
            <>
              <div className="card-title">This Month's Duties</div>
              {recentDuties.length === 0 && <div className="empty-note">No duties recorded this month.</div>}
              {recentDuties.map(({ dateStr, a }) => (
                <DutyRow key={dateStr} dateStr={dateStr} code={a.shiftDef.code} def={shiftDefByCode[a.shiftDef.code]} a={a} />
              ))}
            </>
          )}

          {tab === "Leave" && (
            <>
              {leaves === null && <div className="empty-note">Loading…</div>}
              {leaves && leaves.length === 0 && <div className="empty-note">No approved leave on record.</div>}
              {leaves && leaves.map(l => (
                <div key={l.id} className="alert-card amber" style={{ marginBottom: 6 }}>
                  <span>🏖</span>
                  <div>
                    <div className="alert-card-title">{l.leaveType}</div>
                    <div className="alert-card-sub">{fmt(l.fromDate)} – {fmt(l.toDate)}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "Qualifications" && (
            <>
              {compliance === null && <div className="empty-note">Loading…</div>}
              {compliance && (
                <>
                  {[...(compliance.qualifications || []), ...(compliance.licenses || [])].length === 0 && (
                    <div className="empty-note">No qualifications or licenses on record.</div>
                  )}
                  {[...(compliance.qualifications || []), ...(compliance.licenses || [])].map(q => (
                    <div key={q.id} className={`qual-card`} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="qual-name">{q.name || q.type || q.licenseType}</span>
                        <span className={`qual-status qs-${(q.status || "valid").toLowerCase()}`}>{q.status}</span>
                      </div>
                      {q.expiryDate && <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 3 }}>Expires {fmt(q.expiryDate)}</div>}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {loadErr && <div className="ab red">{loadErr}</div>}

          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 16 }} onClick={() => onEditToday(staff)}>
            ✎ Edit Shift
          </button>
        </div>
      </div>
    </div>
  );
}

function DutyRow({ dateStr, code, def, a }) {
  const in1 = a?.in1 || def?.startTime;
  const out1 = a?.out1 || def?.endTime;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-dim)", width: 62, flexShrink: 0 }}>{dateStr.slice(5)}</span>
      <span className="sc-code" style={{ background: def?.color, color: "#000", padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{code}</span>
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 10 }}>{in1 ? `${in1}–${out1}` : def?.name || ""}</span>
    </div>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split("(")[0].trim().split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmt(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : ""; }
