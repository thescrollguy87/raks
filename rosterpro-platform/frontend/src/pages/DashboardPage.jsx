import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { getDashboardSummary } from "../api/dashboard.js";
import { listActivity } from "../api/audit.js";
import { useStation } from "../store/StationContext.jsx";

export default function DashboardPage() {
  const { stationId, loading: stationLoading, currentStation } = useStation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null); // null | { title, rows: [{primary, secondary, tone}] }

  usePageHeader({ title: "Dashboard", subtitle: currentStation ? `${currentStation.iataCode} · Real-time overview` : "" });

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getDashboardSummary(stationId),
      listActivity({ pageSize: 8 }).catch(() => ({ items: [] })), // recent-changes feed is a nice-to-have; don't block the dashboard on it
    ])
      .then(([d, a]) => { if (!cancelled) { setData(d); setActivity(a.items || a); } })
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

  const { qualificationExpiry, leaveBalance, dgcaCompliance, flightCoverage, rosterCoverage, staffWorkload, today } = data;
  const alerts = rosterCoverage?.violations || [];
  const expiredItems = [
    ...qualificationExpiry.qualifications.items.filter(q => new Date(q.expiryDate) < new Date()).map(q => ({ primary: q.user.fullName, secondary: `${q.qualCode} — expired ${fmtDate(q.expiryDate)}`, tone: "red" })),
    ...qualificationExpiry.licenses.items.filter(l => new Date(l.expiryDate) < new Date()).map(l => ({ primary: l.user.fullName, secondary: `License ${l.licenseNo} (${l.category}) — expired ${fmtDate(l.expiryDate)}`, tone: "red" })),
  ];
  const expiringItems = [
    ...qualificationExpiry.qualifications.items.filter(q => new Date(q.expiryDate) >= new Date()).map(q => ({ primary: q.user.fullName, secondary: `${q.qualCode} — expires ${fmtDate(q.expiryDate)}`, tone: "amber" })),
    ...qualificationExpiry.licenses.items.filter(l => new Date(l.expiryDate) >= new Date()).map(l => ({ primary: l.user.fullName, secondary: `License ${l.licenseNo} (${l.category}) — expires ${fmtDate(l.expiryDate)}`, tone: "amber" })),
  ];
  const expiredCount = expiredItems.length;
  const expiringCount = expiringItems.length;
  const maxCategoryCount = Math.max(1, ...Object.values(today.byCategory));

  const alertRows = (list) => list.map(a => ({ primary: `${a.date} · ${a.shift}`, secondary: a.issue, tone: "red" }));
  const openAlerts = () => setDetail({ title: `Compliance Alerts (${alerts.length})`, rows: alertRows(alerts), empty: "No coverage gaps this month." });
  const openExpired = () => setDetail({ title: `Qualifications Expired (${expiredCount})`, rows: expiredItems, empty: "Nothing expired." });
  const openExpiring = () => setDetail({ title: `Expiring in 30 days (${expiringCount})`, rows: expiringItems, empty: "Nothing expiring soon." });

  return (
    <div>
      {/* Headline numbers get the same bold stat-card treatment reference-ui
          uses on its dashboard — a colored top accent and one big number,
          for the metrics someone actually glances at first — while the
          denser multi-metric widgets below stay as compact label/value
          rows, since those hold several related figures each. Every card
          is clickable through to the real records behind its number —
          never just decoration. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard tone="sky" label="Total Active Staff" value={dgcaCompliance.totalActiveStaff} icon="👥" onClick={() => navigate("/staff")} />
        <StatCard tone="green" label="On Duty Today" value={today.onDutyToday} icon="✅" onClick={() => navigate("/roster")} />
        <StatCard tone={alerts.length > 0 ? "red" : "neutral"} label="Compliance Alerts" value={alerts.length} icon="🚨" onClick={openAlerts} />
        <StatCard tone={expiredCount > 0 ? "red" : "neutral"} label="Qualifications Expired" value={expiredCount} icon="🔒" onClick={openExpired} />
        <StatCard tone={expiringCount > 0 ? "amber" : "neutral"} label="Expiring (30 days)" value={expiringCount} icon="⚠️" onClick={openExpiring} />
      </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      <Widget title="📊 Today's Coverage by Category">
        {Object.entries(today.byCategory).some(([, n]) => n > 0) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {Object.entries(today.byCategory).map(([cat, n]) => (
              <div
                className="cov-row" key={cat} onClick={() => navigate(`/roster?category=${cat}`)}
                style={{ cursor: "pointer" }} title={`View ${cat} staff in Shift Roster`}
              >
                <span className="cov-row-label"><span className={`tag cat-${cat}`}>{cat}</span></span>
                <div className="cov-row-track">
                  <div className="cov-row-fill" style={{ width: `${n === 0 ? 0 : Math.max(6, (n / maxCategoryCount) * 100)}%`, background: CAT_COLORS[cat] || "var(--sky)" }} />
                </div>
                <span className="cov-row-val">{n}</span>
              </div>
            ))}
          </div>
        ) : <div className="empty-note">No one on duty today.</div>}
        {today.gaps.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            {today.gaps.map((g, i) => (
              <div key={i} className="alert-card red">
                <span>⚠</span>
                <div>
                  <div className="alert-card-title">{g.shift}</div>
                  <div className="alert-card-sub">{g.issue}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Widget>

      <Widget title="🚨 Compliance Alerts">
        {alerts.length === 0 ? (
          <div className="empty-note">✅ No coverage gaps this month.</div>
        ) : (
          <>
            <StatRow label="Coverage Gaps (this month)" value={alerts.length} tone="red" />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
              {alerts.slice(0, 5).map((a, i) => (
                <div key={i} className="alert-card amber">
                  <span>⚠</span>
                  <div>
                    <div className="alert-card-title">{a.date} · {a.shift}</div>
                    <div className="alert-card-sub">{a.issue}</div>
                  </div>
                </div>
              ))}
              {alerts.length > 5 && (
                <button className="btn btn-ghost btn-sm" onClick={openAlerts}>View all {alerts.length}</button>
              )}
            </div>
          </>
        )}
      </Widget>

      <Widget title="🎓 Qualification Expiry">
        <StatRow label="Expired" value={expiredCount} tone={expiredCount > 0 ? "red" : "neutral"} onClick={expiredCount > 0 ? openExpired : undefined} />
        <StatRow label="Expiring (30 days)" value={expiringCount} tone={expiringCount > 0 ? "amber" : "neutral"} onClick={expiringCount > 0 ? openExpiring : undefined} />
      </Widget>

      <Widget title="🏖 Leave Balance">
        <StatRow
          label="Staff" value={leaveBalance.staffCount}
          onClick={leaveBalance.balances.length > 0 ? () => setDetail({
            title: `Leave Balance — ${leaveBalance.year}`,
            rows: leaveBalance.balances.map(b => ({ primary: b.fullName, secondary: `${b.balance.ANNUAL?.taken ?? 0} of ${b.balance.ANNUAL?.entitlement ?? 0} annual days taken` })),
            empty: "No staff.",
          }) : undefined}
        />
        <div className="gauge-row">
          <Gauge value={leaveBalance.annualUtilization} tone={leaveBalance.annualUtilization > 90 ? "amber" : "sky"} />
          <div className="gauge-label">
            <div className="gauge-label-title">Annual Leave Utilization</div>
            <div className="gauge-label-sub">{leaveBalance.annualUtilization}% of allowance used</div>
          </div>
        </div>
      </Widget>

      <Widget title="⚖️ DGCA Compliance">
        <div className="gauge-row">
          <Gauge value={dgcaCompliance.complianceRate} tone={dgcaCompliance.complianceRate < 90 ? "red" : "green"} />
          <div className="gauge-label">
            <div className="gauge-label-title">Compliance Rate</div>
            <div className="gauge-label-sub">{dgcaCompliance.complianceRate}% of staff compliant</div>
          </div>
        </div>
        <StatRow
          label="Blocked Staff" value={dgcaCompliance.blockedStaffCount} tone={dgcaCompliance.blockedStaffCount > 0 ? "red" : "neutral"}
          onClick={dgcaCompliance.blockedStaffCount > 0 ? () => setDetail({
            title: `Blocked Staff (${dgcaCompliance.blockedStaffCount})`,
            rows: dgcaCompliance.blockedStaff.map(s => ({ primary: s.fullName, secondary: "Expired qualification/license — blocked from duty" })),
            empty: "None blocked.",
          }) : undefined}
        />
      </Widget>

      <Widget title="✈️ Flight Coverage">
        <StatRow label="Total Flights" value={flightCoverage.totalFlights} onClick={() => navigate("/flights")} />
        <StatRow label="On-Time Rate" value={`${flightCoverage.onTimeRate}%`} onClick={() => navigate("/flights")} />
        <StatRow label="Engineering Delay Minutes" value={flightCoverage.totalEngineeringDelayMinutes} onClick={() => navigate("/flights")} />
      </Widget>

      <Widget title="📅 Roster Coverage">
        {rosterCoverage ? (
          <>
            <StatRow label="Status" value={rosterCoverage.isPublished ? "Published" : "Draft"} onClick={() => navigate("/roster")} />
            <StatRow
              label="Coverage Violations" value={rosterCoverage.violationCount} tone={rosterCoverage.violationCount > 0 ? "red" : "green"}
              onClick={rosterCoverage.violationCount > 0 ? openAlerts : undefined}
            />
          </>
        ) : <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No roster generated yet this month.</div>}
      </Widget>

      <Widget title="👥 Staff Workload">
        {staffWorkload ? (
          <>
            <StatRow label="Avg Days on Duty" value={staffWorkload.avgDaysOnDuty} />
            <StatRow
              label="Overloaded Staff" value={staffWorkload.overloaded.length} tone={staffWorkload.overloaded.length > 0 ? "amber" : "green"}
              onClick={staffWorkload.overloaded.length > 0 ? () => setDetail({
                title: `Overloaded Staff (${staffWorkload.overloaded.length})`,
                rows: staffWorkload.overloaded.map(w => ({ primary: w.fullName, secondary: `${w.totalDaysOnDuty} days on duty this month (avg ${staffWorkload.avgDaysOnDuty})`, tone: "amber" })),
                empty: "No one overloaded.",
              }) : undefined}
            />
          </>
        ) : <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No roster generated yet this month.</div>}
      </Widget>

      <Widget title="🕐 Recent Changes" wide>
        {!activity || activity.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No recent activity.</div>
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

function StatCard({ tone, label, value, icon, onClick }) {
  return (
    <div
      className={`stat-card ${tone}`} onClick={onClick}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      style={onClick ? { cursor: "pointer" } : undefined}
      title={onClick ? `View ${label.toLowerCase()} detail` : undefined}
    >
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Widget({ title, children, wide }) {
  return (
    <div className="card" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="card-title">{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{children}</div>
    </div>
  );
}

// Category chip colors reused from the Shift Roster's own .cat-* palette
// (rosterpro.css), so a category reads the same color on both screens.
const CAT_COLORS = { B1: "#60AAFF", B2: "#60CCFF", CM: "#C08FFF", NCS: "#5DDDAA", STO: "#FFC07A" };

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
