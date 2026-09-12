import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { getDashboardSummary, getStationsOverview } from "../api/dashboard.js";
import { listActivity } from "../api/audit.js";
import { listLeave } from "../api/leave.js";
import { useStation } from "../store/StationContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";

const CAT_COLORS = { B1: "#3B82F6", B2: "#22D3EE", CM: "#A78BFA", NCS: "#34D399", STO: "#FBBF24" };
const SHIFT_COLORS = { M: "#3B82F6", A: "#22C55E", N: "#8B5CF6", Others: "#94A3B8" };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function DashboardPage() {
  const { stationId, loading: stationLoading, currentStation, stations } = useStation();
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState(null);
  const [upcomingLeave, setUpcomingLeave] = useState(null);
  const [stationsOverview, setStationsOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null); // null | { title, rows: [{primary, secondary, tone}] }

  const firstName = (user?.fullName || "").split(" ")[0];
  const todayStr = new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const canGenerate = hasPermission("roster", "update");

  // actions must stay referentially stable across renders — usePageHeader
  // syncs it into context state via an effect, so a fresh JSX element here
  // every render (this component itself re-renders often, e.g. whenever
  // `detail` opens/closes) would re-trigger that sync forever. Same
  // pitfall RosterPage.jsx's own headerActions comment documents.
  const headerActions = useMemo(() => (
    <>
      <span className="tag" style={{ fontSize: 11, padding: "5px 10px" }}>📅 {todayStr}</span>
      {canGenerate && (
        <button className="btn btn-primary" onClick={() => navigate("/auto-roster")}>✨ Generate Roster</button>
      )}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [canGenerate, todayStr]);

  usePageHeader({
    title: `${greeting()}, ${firstName || "there"}!`,
    subtitle: currentStation ? `Here's your roster overview for ${currentStation.iataCode} – ${currentStation.name}` : "",
    actions: headerActions,
  });

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    setLoading(true);
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    Promise.all([
      getDashboardSummary(stationId),
      listActivity({ pageSize: 8 }).catch(() => ({ items: [] })), // recent-changes feed is a nice-to-have; don't block the dashboard on it
      listLeave({ stationId, status: "APPROVED", from: todayIso, to: weekAhead, pageSize: 20 }).catch(() => null),
      getStationsOverview().catch(() => null), // airline-wide only; a station-scoped caller just gets their own one row
    ])
      .then(([d, a, leave, stationsOv]) => {
        if (cancelled) return;
        setData(d); setActivity(a.items || a);
        setUpcomingLeave(leave?.items || null);
        setStationsOverview(stationsOv?.stations || null);
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stationId]);

  // Order matters: stationLoading must be checked before `loading` below —
  // otherwise the render right after StationContext resolves a real
  // stationId (but before this component's own fetch-effect has re-run
  // for it) would fall through with a stale `loading === false` from an
  // earlier "no station yet" pass, and crash destructuring `data` (null).
  if (stationLoading) return <div className="card">Loading dashboard…</div>;
  if (!stationId) return <div className="ab info">No station has been set up yet — ask an administrator to add one before the dashboard has anything to show.</div>;
  if (loading) return <div className="card">Loading dashboard…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  const { qualificationExpiry, leaveBalance, dgcaCompliance, flightCoverage, rosterCoverage, today, workloadTrend } = data;
  const alerts = rosterCoverage?.violations || [];
  const todayGaps = today.gaps || [];
  // A true subset of `alerts` (same monthly list the KPI card's own count
  // comes from) — not today's separate gap count, which could legitimately
  // disagree with the total and read as "the numbers don't add up".
  const criticalAlerts = rosterCoverage?.criticalCount ?? alerts.filter(a => a.severity === "critical").length;
  const expiredItems = [
    ...qualificationExpiry.qualifications.items.filter(q => new Date(q.expiryDate) < new Date()).map(q => ({ primary: q.user.fullName, secondary: `${q.qualCode} — expired ${fmtDate(q.expiryDate)}`, tone: "red" })),
    ...qualificationExpiry.licenses.items.filter(l => new Date(l.expiryDate) < new Date()).map(l => ({ primary: l.user.fullName, secondary: `License ${l.licenseNo} (${l.category}) — expired ${fmtDate(l.expiryDate)}`, tone: "red" })),
    ...qualificationExpiry.authorizations.items.filter(a => new Date(a.expiryDate) < new Date()).map(a => ({ primary: a.user.fullName, secondary: `Authorization ${a.scope} — expired ${fmtDate(a.expiryDate)}`, tone: "red" })),
  ];
  const expiringItems = [
    ...qualificationExpiry.qualifications.items.filter(q => new Date(q.expiryDate) >= new Date()).map(q => ({ primary: q.user.fullName, secondary: `${q.qualCode} — expires ${fmtDate(q.expiryDate)}`, tone: "amber" })),
    ...qualificationExpiry.licenses.items.filter(l => new Date(l.expiryDate) >= new Date()).map(l => ({ primary: l.user.fullName, secondary: `License ${l.licenseNo} (${l.category}) — expires ${fmtDate(l.expiryDate)}`, tone: "amber" })),
    ...qualificationExpiry.authorizations.items.filter(a => new Date(a.expiryDate) >= new Date()).map(a => ({ primary: a.user.fullName, secondary: `Authorization ${a.scope} — expires ${fmtDate(a.expiryDate)}`, tone: "amber" })),
  ];
  const expiredCount = expiredItems.length;
  const expiringCount = expiringItems.length;
  const blockedStaffCount = dgcaCompliance.blockedStaffCount || 0;
  const maxCategoryCount = Math.max(1, ...Object.values(today.byCategory));
  const onDutyPct = today.totalStaff > 0 ? Math.round((today.onDutyToday / today.totalStaff) * 100) : 0;

  const alertRows = (list) => list.map(a => ({ primary: `${a.date} · ${a.shift}`, secondary: a.issue, tone: "red" }));
  const openAlerts = () => setDetail({ title: `Compliance Alerts (${alerts.length})`, rows: alertRows(alerts), empty: "No coverage gaps this month." });
  const openExpired = () => setDetail({ title: `Qualifications Expired (${expiredCount})`, rows: expiredItems, empty: "Nothing expired." });
  const openExpiring = () => setDetail({ title: `Expiring in 30 days (${expiringCount})`, rows: expiringItems, empty: "Nothing expiring soon." });
  const openBlocked = () => setDetail({
    title: `Staff Blocked From Duty (${blockedStaffCount})`,
    rows: (dgcaCompliance.blockedStaff || []).map(s => ({ primary: s.fullName, secondary: s.reasons.join("; ") || "Expired qualification, license, or authorization", tone: "red" })),
    empty: "No staff currently blocked.",
  });

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard tone="sky" icon="👥" label="Total Staff" value={dgcaCompliance.totalActiveStaff} sub="Active at this station" onClick={() => navigate("/staff")} />
        <KpiCard tone="sky" icon="✈️" label="Total Flights" value={flightCoverage.totalFlights} sub="This month" onClick={() => navigate("/flights")} />
        <KpiCard tone="green" icon="✅" label="On Duty Today" value={today.onDutyToday} sub={`${onDutyPct}% of staff`} onClick={() => navigate("/roster")} />
        <KpiCard tone={alerts.length > 0 ? "red" : "neutral"} icon="⚠️" label="Compliance Alerts" value={alerts.length} sub={criticalAlerts > 0 ? `${criticalAlerts} critical` : alerts.length > 0 ? "This month" : "None open"} onClick={openAlerts} />
        <KpiCard tone={expiredCount > 0 ? "red" : "neutral"} icon="🎓" label="Qualifications Expired" value={expiredCount} sub={expiredCount > 0 ? "Needs attention" : "All up to date"} onClick={openExpired} />
        <KpiCard tone={expiringCount > 0 ? "amber" : "neutral"} icon="⏰" label="Expiring (30 days)" value={expiringCount} sub={expiringCount > 0 ? "Plan renewals" : "No upcoming"} onClick={openExpiring} />
        <KpiCard tone={blockedStaffCount > 0 ? "red" : "neutral"} icon="🔒" label="Staff Blocked" value={blockedStaffCount} sub={blockedStaffCount > 0 ? "Cannot be rostered" : "Everyone cleared"} onClick={openBlocked} />
      </div>

      {blockedStaffCount > 0 && (
        <div className="ab red" style={{ marginBottom: 14 }}>
          🔒 {blockedStaffCount} staff member{blockedStaffCount === 1 ? "" : "s"} {blockedStaffCount === 1 ? "has" : "have"} an expired qualification, license, or authorization and {blockedStaffCount === 1 ? "is" : "are"} blocked from full-scope duty.{" "}
          <button className="btn btn-ghost btn-sm" onClick={openBlocked} style={{ marginLeft: 4 }}>View details</button>
        </div>
      )}

      {/* Today's Staff by Category / Shift Distribution / Compliance Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Widget title="👥 Today's Staff by Category">
          {Object.entries(today.byCategory).some(([, n]) => n > 0) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(today.byCategory).map(([cat, n]) => (
                <div
                  className="cov-row" key={cat} onClick={() => navigate(`/roster?category=${cat}`)}
                  style={{ cursor: "pointer" }} title={`View ${cat} staff in Shift Roster`}
                >
                  <span className="cov-row-label"><span className={`tag cat-${cat}`}>{cat}</span></span>
                  <div className="cov-row-track">
                    <div className="cov-row-fill" style={{ width: `${n === 0 ? 0 : Math.max(6, (n / maxCategoryCount) * 100)}%`, background: CAT_COLORS[cat] }} />
                  </div>
                  <span className="cov-row-val">{n}</span>
                </div>
              ))}
            </div>
          ) : <div className="empty-note">No one on duty today.</div>}
        </Widget>

        <Widget title="📊 Shift Distribution (Today)">
          <ShiftDonut byShift={today.byShift} total={today.onDutyToday} />
        </Widget>

        <Widget title="🚨 Compliance Alerts">
          {todayGaps.length === 0 && alerts.length === 0 ? (
            <div className="empty-note">✅ No coverage gaps.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {todayGaps.map((g, i) => (
                <div key={`t${i}`} className={`alert-card ${g.severity === "critical" ? "red" : "amber"}`}>
                  <span>{g.severity === "critical" ? "🔴" : "⚠"}</span>
                  <div>
                    <div className="alert-card-title">{g.issue}</div>
                    <div className="alert-card-sub">Today · {g.shift} shift</div>
                  </div>
                </div>
              ))}
              {alerts.slice(0, Math.max(0, 4 - todayGaps.length)).map((a, i) => (
                <div key={`m${i}`} className="alert-card amber">
                  <span>⚠</span>
                  <div>
                    <div className="alert-card-title">{a.date} · {a.shift}</div>
                    <div className="alert-card-sub">{a.issue}</div>
                  </div>
                </div>
              ))}
              {(alerts.length + todayGaps.length) > 4 && (
                <button className="btn btn-ghost btn-sm" onClick={openAlerts}>View all {alerts.length} this month</button>
              )}
            </div>
          )}
        </Widget>
      </div>

      {/* Leave Balance / Flight Coverage / Roster Status */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Widget title="🏖 Leave Balance">
          <div className="gauge-row">
            <Gauge value={leaveBalance.annualUtilization} tone={leaveBalance.annualUtilization > 90 ? "amber" : "sky"} size={64} strokeWidth={7} />
            <div className="gauge-label">
              <div className="gauge-label-title">Annual Leave Utilization</div>
              <div className="gauge-label-sub">{leaveBalance.annualUtilization}% of allowance used</div>
            </div>
          </div>
          <StatRow
            label="Total Staff" value={leaveBalance.staffCount}
            onClick={leaveBalance.balances.length > 0 ? () => setDetail({
              title: `Leave Balance — ${leaveBalance.year}`,
              rows: leaveBalance.balances.map(b => ({ primary: b.fullName, secondary: `${b.balance.ANNUAL?.taken ?? 0} of ${b.balance.ANNUAL?.entitlement ?? 0} annual days taken` })),
              empty: "No staff.",
            }) : undefined}
          />
        </Widget>

        <Widget title="✈️ Flight Coverage">
          <div className="gauge-row">
            <Gauge value={flightCoverage.onTimeRate} tone={flightCoverage.onTimeRate < 90 ? "amber" : "green"} size={64} strokeWidth={7} />
            <div className="gauge-label">
              <div className="gauge-label-title">On-Time Coverage</div>
              <div className="gauge-label-sub">{flightCoverage.onTimeRate}% of flights on time</div>
            </div>
          </div>
          <StatRow label="Total Flights" value={flightCoverage.totalFlights} onClick={() => navigate("/flights")} />
          <StatRow label="Engineering Delay (min)" value={flightCoverage.totalEngineeringDelayMinutes} onClick={() => navigate("/flights")} />
        </Widget>

        <RosterStatusWidget rosterCoverage={rosterCoverage} station={currentStation} onOpenRoster={() => navigate("/roster")} onOpenAlerts={openAlerts} />
      </div>

      {/* Staff Workload trend + Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <Widget title={`📈 Staff Workload (Next ${workloadTrend?.days || 14} Days)`}>
          {workloadTrend ? <WorkloadTrendChart trend={workloadTrend.trend} /> : <div className="empty-note">No roster data for the upcoming days yet.</div>}
        </Widget>

        <Widget title="⚡ Quick Actions">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <QuickAction icon="⬆" label="Import Excel" onClick={() => navigate("/import-export")} show={hasPermission("roster", "update")} />
            <QuickAction icon="✨" label="Auto Generate" onClick={() => navigate("/auto-roster")} show={canGenerate} />
            <QuickAction icon="📊" label="View Reports" onClick={() => navigate("/reports")} show={hasPermission("reports", "read")} />
            <QuickAction icon="📅" label="Manage Leave" onClick={() => navigate("/leave")} show={hasPermission("leave", "read")} />
          </div>
        </Widget>
      </div>

      {/* Recent Changes / Upcoming Leave / Station Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <Widget title="🕐 Recent Changes">
          {!activity || activity.length === 0 ? (
            <div className="empty-note">No recent activity.</div>
          ) : (
            <div className="timeline">
              {activity.map(a => (
                <div className="tl-item" key={a.id}>
                  <div className="tl-dot change" />
                  <div className="tl-content">
                    <div className="tl-hdr">
                      <span className="tl-user">{a.action}</span>
                      <span className="tl-ts">{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                    {a.detail && <div className="tl-action">{a.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

        <Widget title="🏖 Upcoming Leave (Next 7 Days)">
          {upcomingLeave === null ? (
            <div className="empty-note">Unable to load leave data.</div>
          ) : upcomingLeave.length === 0 ? (
            <div className="empty-note">No approved leave in the next 7 days.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {upcomingLeave.slice(0, 6).map(l => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{l.user?.fullName || "—"}</div>
                    <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{fmtDate(l.fromDate)} – {fmtDate(l.toDate)}</div>
                  </div>
                  <span className="tag">{leaveDays(l.fromDate, l.toDate)} day{leaveDays(l.fromDate, l.toDate) === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          )}
        </Widget>

        {stationsOverview && stationsOverview.length > 1 && (
          <Widget title="🗺️ Station Overview">
            <div style={{ overflowX: "auto" }}>
              <table className="dc-table">
                <thead>
                  <tr><th style={{ textAlign: "left" }}>Station</th><th>Staff</th><th>Flights</th><th>Coverage</th></tr>
                </thead>
                <tbody>
                  {stationsOverview.slice(0, 8).map(s => (
                    <tr key={s.stationId} style={{ cursor: "pointer" }} title={`${s.name} — on duty today`}>
                      <td style={{ textAlign: "left", fontWeight: 700 }}>{s.iataCode}</td>
                      <td>{s.staffCount}</td>
                      <td>{s.flightsThisMonth}</td>
                      <td>
                        <span className={`metric-badge ${s.coveragePct >= 90 ? "green" : s.coveragePct >= 70 ? "amber" : "red"}`}>{s.coveragePct}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Widget>
        )}
      </div>

      {detail && (
        <div className="modal-overlay open" onClick={() => setDetail(null)}>
          <div className="popover-card" style={{ width: 420, maxHeight: "70vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetail(null)}>✕</button>
            <div className="card-title" style={{ marginBottom: 10 }}>{detail.title}</div>
            {detail.rows.length === 0 ? (
              <div className="empty-note">{detail.empty || "Nothing to show."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {detail.rows.map((r, i) => (
                  <div key={i} className={`alert-card ${r.tone || "amber"}`}>
                    <span>{r.tone === "red" ? "⚠" : "•"}</span>
                    <div>
                      <div className="alert-card-title">{r.primary}</div>
                      <div className="alert-card-sub">{r.secondary}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ tone, icon, label, value, sub, onClick }) {
  return (
    <div
      className={`stat-card ${tone}`} onClick={onClick}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      style={onClick ? { cursor: "pointer" } : undefined}
      title={onClick ? `View ${label.toLowerCase()} detail` : undefined}
    >
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Widget({ title, children }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>{children}</div>
    </div>
  );
}

function StatRow({ label, value, tone, onClick }) {
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick} title={onClick ? `View ${label.toLowerCase()} detail` : undefined}
    >
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      {tone ? (
        <span className={`metric-badge ${tone}`}>{value}</span>
      ) : (
        <span style={{ fontWeight: 700, color: "var(--white)" }}>{value}</span>
      )}
    </div>
  );
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";
}
function leaveDays(from, to) {
  return Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
}

// Circular percentage gauge — an SVG ring (stroke-dasharray sized to the
// value) with the number centered inside, for DGCA Compliance / Leave Balance.
function Gauge({ value, tone = "sky", size = 46, strokeWidth = 5 }) {
  const pct = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = { sky: "var(--sky)", green: "var(--rp-green)", amber: "var(--amber)", red: "var(--rp-red)" }[tone] || "var(--sky)";
  return (
    <div className="gauge-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="gauge-ring-value">{Math.round(pct)}%</div>
    </div>
  );
}

// Multi-segment donut for "Shift Distribution (Today)" — each shift bucket
// gets an arc proportional to its share of onDutyToday, with the total
// on-duty count centered, and a legend with the real per-shift counts.
function ShiftDonut({ byShift, total }) {
  const size = 130, strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const entries = ["M", "A", "N", "Others"].map(key => ({ key, label: key === "M" ? "Morning" : key === "A" ? "Afternoon" : key === "N" ? "Night" : "Others", value: byShift?.[key] || 0 }));

  let offsetAccum = 0;
  const segments = entries.filter(e => e.value > 0).map(e => {
    const frac = total > 0 ? e.value / total : 0;
    const len = frac * circumference;
    const seg = { ...e, dasharray: `${len} ${circumference - len}`, dashoffset: -offsetAccum };
    offsetAccum += len;
    return seg;
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div className="gauge-ring" style={{ width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,23,42,.06)" strokeWidth={strokeWidth} />
          {segments.map(s => (
            <circle
              key={s.key} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={SHIFT_COLORS[s.key]} strokeWidth={strokeWidth}
              strokeDasharray={s.dasharray} strokeDashoffset={s.dashoffset}
            />
          ))}
        </svg>
        <div className="gauge-ring-value" style={{ fontSize: 20, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span>{total}</span>
          <span style={{ fontSize: 9, fontWeight: 500, color: "var(--text-dim)", textTransform: "none" }}>On Duty</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map(e => (
          <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: SHIFT_COLORS[e.key], display: "inline-block" }} />
            <span style={{ color: "var(--text-dim)", minWidth: 62 }}>{e.label}</span>
            <span style={{ fontWeight: 700 }}>{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Simple CSS bar chart — On Duty (blue) + On Leave (pink) side-by-side
// mini-bars per day, scaled to the trend window's own max so the tallest
// bar always reaches the top regardless of station size.
function WorkloadTrendChart({ trend }) {
  const max = Math.max(1, ...trend.map(t => Math.max(t.onDuty, t.onLeave)));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, borderBottom: "1px solid var(--border)", paddingBottom: 2 }}>
        {trend.map(t => (
          <div key={t.date} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1, height: "100%" }} title={`${fmtDate(t.date)}: ${t.onDuty} on duty, ${t.onLeave} on leave`}>
            <div style={{ flex: 1, height: `${Math.max(2, (t.onDuty / max) * 100)}%`, background: "var(--sky)", borderRadius: "3px 3px 0 0" }} />
            {t.onLeave > 0 && <div style={{ flex: 1, height: `${Math.max(2, (t.onLeave / max) * 100)}%`, background: "#F472B6", borderRadius: "3px 3px 0 0" }} />}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {trend.map(t => (
          <div key={t.date} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "var(--text-dim)" }}>
            {new Date(t.date).getDate()}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--sky)", display: "inline-block" }} /> On Duty</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#F472B6", display: "inline-block" }} /> On Leave</span>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick, show = true }) {
  if (!show) return null;
  return (
    <button
      className="btn btn-ghost" onClick={onClick}
      style={{ flexDirection: "column", gap: 4, padding: "14px 8px", height: "auto" }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 10 }}>{label}</span>
    </button>
  );
}

function RosterStatusWidget({ rosterCoverage, station, onOpenRoster, onOpenAlerts }) {
  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>📋 Roster Status</span>
        {rosterCoverage && (
          <span className={`metric-badge ${rosterCoverage.isPublished ? "green" : "amber"}`}>{rosterCoverage.isPublished ? "Published" : "Draft"}</span>
        )}
      </div>
      {!rosterCoverage ? (
        <div className="empty-note">No roster generated yet this month.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <StatRow label="Month" value={rosterCoverage.monthKey} />
          <StatRow label="Station" value={station ? `${station.iataCode} – ${station.name}` : "—"} />
          <StatRow label="Last Generated" value={fmtDateTime(rosterCoverage.createdAt)} />
          <StatRow label="Last Updated" value={fmtDateTime(rosterCoverage.updatedAt)} />
          <StatRow label="Updated By" value={rosterCoverage.updatedByName || "—"} />
          {rosterCoverage.violationCount > 0 && (
            <StatRow label="Coverage Violations" value={rosterCoverage.violationCount} tone="red" onClick={onOpenAlerts} />
          )}
          <button className="btn btn-primary btn-sm" style={{ marginTop: 4, justifyContent: "center" }} onClick={onOpenRoster}>Open Shift Roster →</button>
        </div>
      )}
    </div>
  );
}

function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}
