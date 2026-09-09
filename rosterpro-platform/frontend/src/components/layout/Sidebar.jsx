import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import AirlineSwitcher from "./AirlineSwitcher.jsx";

// Same structure/classes as the prototype's <aside class="sidebar">: s-logo,
// nav, nav-sl section labels, ni nav items with ni-icon/ni-badge, s-foot
// user card. NavLink's `active` state substitutes for the prototype's
// showPage() manually toggling a class on the clicked button.
const NAV_SECTIONS = [
  { label: "Roster", items: [
    { to: "/", icon: "📊", label: "Dashboard" },
    { to: "/roster", icon: "📅", label: "Shift Roster" },
    { to: "/auto-roster", icon: "🤖", label: "Auto Generator", permission: ["roster", "update"] },
    { to: "/coverage", icon: "📈", label: "Daily Coverage", permission: ["roster", "read"] },
  ]},
  { label: "Operations", items: [
    { to: "/flight-schedule", icon: "🛫", label: "Flight Schedule", permission: ["roster", "update"] },
    { to: "/staff", icon: "🧑‍🔧", label: "Staff Registry", permission: ["staff", "read"] },
    { to: "/qualifications", icon: "🎓", label: "Qualifications", permission: ["qualification", "read"] },
    { to: "/leave", icon: "🏖", label: "Leave & Absence", permission: ["leave", "read"] },
  ]},
  { label: "Reports", items: [
    { to: "/reports", icon: "📄", label: "Staff Reports", permission: ["reports", "export"] },
    { to: "/compliance-rules", icon: "⚖️", label: "Compliance Rules" },
    { to: "/history", icon: "🕘", label: "Change History", permission: ["audit_trail", "read"] },
    { to: "/past-rosters", icon: "🗂️", label: "Past Rosters", permission: ["roster", "read"] },
    { to: "/import-export", icon: "🔄", label: "Import / Export", permission: ["reports", "export"] },
  ]},
];

export default function Sidebar() {
  const { user, hasPermission, hasRole, logout } = useAuth();
  const { needsSwitcher, currentStation } = useStation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("rp-sidebar-collapsed") === "1"; } catch { return false; }
  });

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem("rp-sidebar-collapsed", next ? "1" : "0"); } catch { /* private-mode storage denial is fine to ignore here */ }
      return next;
    });
  }

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <button className="sb-collapse-btn" onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? "›" : "‹"}
      </button>
      <div className="s-logo">
        {/* The airline's real name is the top-most line whenever there's more
            than one to distinguish (SUPER_ADMIN/AIRLINE_ADMIN) — otherwise
            a station-scoped user's own single airline never needs naming. */}
        <span className="lm">
          {currentStation?.airlineName || (currentStation ? `${currentStation.iataCode} · M&E` : "M&E")}
        </span>
        <span className="ln">✈ RosterPro</span>
        <span className="ls">
          {collapsed ? "" : currentStation ? `${currentStation.iataCode} — ${currentStation.name} Line Maintenance` : "People • Planes • Performance"}
        </span>
        {needsSwitcher && !collapsed && <AirlineSwitcher />}
      </div>
      <nav className="nav">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <div className="nav-sl">{section.label}</div>
            {section.items
              .filter(item => !item.permission || hasPermission(item.permission[0], item.permission[1]))
              .map(item => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `ni${isActive ? " active" : ""}`} title={collapsed ? item.label : undefined}>
                  <span className="ni-icon">{item.icon}</span><span>{item.label}</span>
                </NavLink>
              ))}
          </div>
        ))}
        <div className="nav-sl">Admin</div>
        {hasRole("SUPER_ADMIN") && (
          <NavLink to="/tenants" className={({ isActive }) => `ni${isActive ? " active" : ""}`} title={collapsed ? "Tenants" : undefined}>
            <span className="ni-icon">🏢</span><span>Tenants</span>
          </NavLink>
        )}
        {hasPermission("billing", "read") && (
          <NavLink to="/billing" className={({ isActive }) => `ni${isActive ? " active" : ""}`} title={collapsed ? "Billing" : undefined}>
            <span className="ni-icon">💳</span><span>Billing</span>
          </NavLink>
        )}
        <NavLink to="/my-account" className={({ isActive }) => `ni${isActive ? " active" : ""}`} title={collapsed ? "My Account" : undefined}>
          <span className="ni-icon">👤</span><span>My Account</span>
        </NavLink>
        <button className="ni" onClick={logout} title={collapsed ? "Sign Out" : undefined}>
          <span className="ni-icon">🔓</span><span>Sign Out</span>
        </button>
      </nav>
      <div className="s-foot">
        <div className="u-card">
          <div className="u-avatar">{initials(user?.fullName)}</div>
          {!collapsed && (
            <div>
              <div className="u-name">{user?.fullName || "Not signed in"}</div>
              <div className="u-role">{user?.roles?.join(", ") || ""}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
