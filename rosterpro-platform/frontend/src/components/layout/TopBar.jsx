import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHeaderState } from "../../store/PageHeaderContext.jsx";
import { useAuth } from "../../store/AuthContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import { getDashboardSummary } from "../../api/dashboard.js";

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

// Matches the prototype's <div class="topbar"><div><div class="topbar-title">
// ...<div class="topbar-sub">...</div></div><div>[actions]</div></div>
// exactly. Content comes from whichever page is currently mounted, via
// usePageHeader() — see store/PageHeaderContext.jsx for why this is a
// context instead of each page rendering its own <TopBar>. The bell's badge
// count AND the list it opens both come from the same dashboard summary
// numbers already shown on the Dashboard page (coverage violations +
// expired quals/licenses) — never a fabricated count with nothing behind it.
export default function TopBar() {
  const { title, subtitle, actions } = useHeaderState();
  const { user } = useAuth();
  const { stationId } = useStation();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    getDashboardSummary(stationId)
      .then(d => { if (!cancelled) setSummary(d); })
      .catch(() => setSummary(null));
    return () => { cancelled = true; };
  }, [stationId]);

  useEffect(() => {
    if (!bellOpen) return;
    function onClickOutside(e) { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); }
    function onEscape(e) { if (e.key === "Escape") setBellOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => { document.removeEventListener("mousedown", onClickOutside); document.removeEventListener("keydown", onEscape); };
  }, [bellOpen]);

  const violations = summary?.rosterCoverage?.violations || [];
  const expiredQuals = (summary?.qualificationExpiry?.qualifications?.items || []).filter(q => new Date(q.expiryDate) < new Date());
  const expiredLicenses = (summary?.qualificationExpiry?.licenses?.items || []).filter(l => new Date(l.expiryDate) < new Date());
  const alertCount = violations.length + expiredQuals.length + expiredLicenses.length;

  function goTo(path) {
    setBellOpen(false);
    navigate(path);
  }

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{subtitle}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto" }}>
        {actions && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{actions}</div>}
        <div ref={bellRef} style={{ position: "relative" }}>
          <div
            className="tb-bell" onClick={() => setBellOpen(v => !v)}
            title={alertCount ? `${alertCount} open alert${alertCount === 1 ? "" : "s"}` : "No open alerts"}
          >
            🔔
            {!!alertCount && <span className="tb-bell-badge">{alertCount > 9 ? "9+" : alertCount}</span>}
          </div>
          {bellOpen && (
            <div className="tb-bell-panel">
              <div className="card-title" style={{ marginBottom: 8 }}>Notifications</div>
              {alertCount === 0 ? (
                <div className="tb-bell-empty">✅ No open alerts.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {violations.map((v, i) => (
                    <div key={`v${i}`} className="alert-card red" style={{ cursor: "pointer" }} onClick={() => goTo("/roster")}>
                      <span>⚠</span>
                      <div>
                        <div className="alert-card-title">{v.date} · {v.shift}</div>
                        <div className="alert-card-sub">{v.issue}</div>
                      </div>
                    </div>
                  ))}
                  {expiredQuals.map(q => (
                    <div key={q.id} className="alert-card red" style={{ cursor: "pointer" }} onClick={() => goTo("/qualifications")}>
                      <span>🔒</span>
                      <div>
                        <div className="alert-card-title">{q.user.fullName}</div>
                        <div className="alert-card-sub">{q.qualCode} expired {fmtDate(q.expiryDate)}</div>
                      </div>
                    </div>
                  ))}
                  {expiredLicenses.map(l => (
                    <div key={l.id} className="alert-card red" style={{ cursor: "pointer" }} onClick={() => goTo("/qualifications")}>
                      <span>🔒</span>
                      <div>
                        <div className="alert-card-title">{l.user.fullName}</div>
                        <div className="alert-card-sub">License {l.licenseNo} expired {fmtDate(l.expiryDate)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => goTo("/")}>
                View Dashboard
              </button>
            </div>
          )}
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
