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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      <Widget title="👥 Staff">
        <StatRow label="Total Active Staff" value={dgcaCompliance.totalActiveStaff} />
        <StatRow label="On Duty Today" value={today.onDutyToday} />
      </Widget>

      <Widget title="📊 Today's Coverage by Category">
        {Object.entries(today.byCategory).some(([, n]) => n > 0) ? (
          Object.entries(today.byCategory).map(([cat, n]) => (
            <StatRow key={cat} label={cat} value={n} />
          ))
        ) : <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No one on duty today.</div>}
        {today.gaps.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {today.gaps.map((g, i) => (
              <div key={i} className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)", fontSize: 10, padding: "4px 8px" }}>
                ⚠ {g.shift}: {g.issue}
              </div>
            ))}
          </div>
        )}
      </Widget>

      <Widget title="🚨 Compliance Alerts">
        {alerts.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--rp-green)" }}>✅ No coverage gaps this month.</div>
        ) : (
          <>
            <StatRow label="Coverage Gaps (this month)" value={alerts.length} tone="red" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
              {alerts.slice(0, 5).map((a, i) => (
                <div key={i} style={{ fontSize: 10, color: "var(--text-dim)" }}>{a.date} · {a.shift} — {a.issue}</div>
              ))}
              {alerts.length > 5 && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>+{alerts.length - 5} more</div>}
            </div>
          </>
        )}
      </Widget>

      <Widget title="🎓 Qualification Expiry">
        <StatRow label="Expired" value={qualificationExpiry.qualifications.expired + qualificationExpiry.licenses.expired} tone="red" />
        <StatRow label="Expiring (30 days)" value={qualificationExpiry.qualifications.expiring + qualificationExpiry.licenses.expiring} tone="amber" />
      </Widget>

      <Widget title="🏖 Leave Balance">
        <StatRow label="Staff" value={leaveBalance.staffCount} />
        <StatRow label="Annual Leave Utilization" value={`${leaveBalance.annualUtilization}%`} />
      </Widget>

      <Widget title="⚖️ DGCA Compliance">
        <StatRow label="Compliance Rate" value={`${dgcaCompliance.complianceRate}%`} tone={dgcaCompliance.complianceRate < 90 ? "red" : "green"} />
        <StatRow label="Blocked Staff" value={dgcaCompliance.blockedStaffCount} tone={dgcaCompliance.blockedStaffCount > 0 ? "red" : "green"} />
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

const TONE_COLORS = { red: "var(--rp-red)", amber: "var(--amber)", green: "var(--rp-green)" };

function StatRow({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ fontWeight: 700, color: tone ? TONE_COLORS[tone] : "var(--white)" }}>{value}</span>
    </div>
  );
}
