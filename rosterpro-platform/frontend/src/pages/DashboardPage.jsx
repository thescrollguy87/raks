import { useState, useEffect } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { getDashboardSummary } from "../api/dashboard.js";
import { listActivity } from "../api/audit.js";
import { useStation } from "../store/StationContext.jsx";

export default function DashboardPage() {
  const { stationId, loading: stationLoading, currentStation } = useStation();
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  const expiredCount = qualificationExpiry.qualifications.expired + qualificationExpiry.licenses.expired;
  const expiringCount = qualificationExpiry.qualifications.expiring + qualificationExpiry.licenses.expiring;
  const maxCategoryCount = Math.max(1, ...Object.values(today.byCategory));

  return (
    <div>
      {/* Headline numbers get the same bold stat-card treatment reference-ui
          uses on its dashboard — a colored top accent and one big number,
          for the metrics someone actually glances at first — while the
          denser multi-metric widgets below stay as compact label/value
          rows, since those hold several related figures each. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard tone="sky" label="Total Active Staff" value={dgcaCompliance.totalActiveStaff} icon="👥" />
        <StatCard tone="green" label="On Duty Today" value={today.onDutyToday} icon="✅" />
        <StatCard tone={alerts.length > 0 ? "red" : "neutral"} label="Compliance Alerts" value={alerts.length} icon="🚨" />
        <StatCard tone={expiredCount > 0 ? "red" : "neutral"} label="Qualifications Expired" value={expiredCount} icon="🔒" />
        <StatCard tone={expiringCount > 0 ? "amber" : "neutral"} label="Expiring (30 days)" value={expiringCount} icon="⚠️" />
      </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      <Widget title="📊 Today's Coverage by Category">
        {Object.entries(today.byCategory).some(([, n]) => n > 0) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {Object.entries(today.byCategory).map(([cat, n]) => (
              <div className="cov-row" key={cat}>
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
              {alerts.length > 5 && <div className="empty-note">+{alerts.length - 5} more</div>}
            </div>
          </>
        )}
      </Widget>

      <Widget title="🎓 Qualification Expiry">
        <StatRow label="Expired" value={expiredCount} tone={expiredCount > 0 ? "red" : "neutral"} />
        <StatRow label="Expiring (30 days)" value={expiringCount} tone={expiringCount > 0 ? "amber" : "neutral"} />
      </Widget>

      <Widget title="🏖 Leave Balance">
        <StatRow label="Staff" value={leaveBalance.staffCount} />
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
        <StatRow label="Blocked Staff" value={dgcaCompliance.blockedStaffCount} tone={dgcaCompliance.blockedStaffCount > 0 ? "red" : "neutral"} />
      </Widget>

      <Widget title="✈️ Flight Coverage">
        <StatRow label="Total Flights" value={flightCoverage.totalFlights} />
        <StatRow label="On-Time Rate" value={`${flightCoverage.onTimeRate}%`} />
        <StatRow label="Engineering Delay Minutes" value={flightCoverage.totalEngineeringDelayMinutes} />
      </Widget>

      <Widget title="📅 Roster Coverage">
        {rosterCoverage ? (
          <>
            <StatRow label="Status" value={rosterCoverage.isPublished ? "Published" : "Draft"} />
            <StatRow label="Coverage Violations" value={rosterCoverage.violationCount} tone={rosterCoverage.violationCount > 0 ? "red" : "green"} />
          </>
        ) : <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No roster generated yet this month.</div>}
      </Widget>

      <Widget title="👥 Staff Workload">
        {staffWorkload ? (
          <>
            <StatRow label="Avg Days on Duty" value={staffWorkload.avgDaysOnDuty} />
            <StatRow label="Overloaded Staff" value={staffWorkload.overloaded.length} tone={staffWorkload.overloaded.length > 0 ? "amber" : "green"} />
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
    </div>
  );
}

function StatCard({ tone, label, value, icon }) {
  return (
    <div className={`stat-card ${tone}`}>
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

function StatRow({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      {tone ? (
        <span className={`metric-badge ${tone}`}>{value}</span>
      ) : (
        <span style={{ fontWeight: 700, color: "var(--white)" }}>{value}</span>
      )}
    </div>
  );
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
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="gauge-ring-value">{Math.round(pct)}%</div>
    </div>
  );
}
