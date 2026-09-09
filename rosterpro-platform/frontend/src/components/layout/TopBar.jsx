import { useEffect, useState } from "react";
import { useHeaderState } from "../../store/PageHeaderContext.jsx";
import { useAuth } from "../../store/AuthContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import { getDashboardSummary } from "../../api/dashboard.js";

// Matches the prototype's <div class="topbar"><div><div class="topbar-title">
// ...<div class="topbar-sub">...</div></div><div>[actions]</div></div>
// exactly. Content comes from whichever page is currently mounted, via
// usePageHeader() — see store/PageHeaderContext.jsx for why this is a
// context instead of each page rendering its own <TopBar>. The bell badge
// and user cluster on the right are new but reuse the same dashboard
// summary numbers already shown on the Dashboard page (coverage violations
// + expired quals/licenses) rather than a fabricated notification count.
export default function TopBar() {
  const { title, subtitle, actions } = useHeaderState();
  const { user } = useAuth();
  const { stationId } = useStation();
  const [alertCount, setAlertCount] = useState(null);

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    getDashboardSummary(stationId)
      .then(d => {
        if (cancelled) return;
        const violations = d?.rosterCoverage?.violationCount || 0;
        const expiredQuals = (d?.qualificationExpiry?.qualifications?.expired || 0) + (d?.qualificationExpiry?.licenses?.expired || 0);
        setAlertCount(violations + expiredQuals);
      })
      .catch(() => setAlertCount(null));
    return () => { cancelled = true; };
  }, [stationId]);

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{subtitle}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto" }}>
        {actions && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{actions}</div>}
        <div className="tb-bell" title={alertCount ? `${alertCount} open alert${alertCount === 1 ? "" : "s"}` : "No open alerts"}>
          🔔
          {!!alertCount && <span className="tb-bell-badge">{alertCount > 9 ? "9+" : alertCount}</span>}
        </div>
        <div className="tb-user">
          <div className="u-avatar" style={{ width: 30, height: 30 }}>{initials(user?.fullName)}</div>
          <div>
            <div className="tb-user-name">{user?.fullName || "Not signed in"}</div>
            <div className="tb-user-role">{user?.roles?.[0] || ""}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
