import { useState, useEffect } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { getDashboardSummary } from "../api/dashboard.js";
import { useStation } from "../store/StationContext.jsx";


export default function DashboardPage() {
  const { stationId } = useStation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageHeader({ title: "Dashboard", subtitle: "AMD · Real-time overview" });

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    setLoading(true);
    getDashboardSummary(stationId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stationId]);

  if (loading) return <div className="card">Loading dashboard…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  const { qualificationExpiry, leaveBalance, dgcaCompliance, flightCoverage, rosterCoverage, staffWorkload } = data;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
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
    </div>
  );
}

function Widget({ title, children }) {
  return (
    <div className="card">
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
