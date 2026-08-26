import { NavLink } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import StationSwitcher from "./StationSwitcher.jsx";

// Same structure/classes as the prototype's <aside class="sidebar">: s-logo,
// nav, nav-sl section labels, ni nav items with ni-icon/ni-badge, s-foot
// user card. NavLink's `active` state substitutes for the prototype's
// showPage() manually toggling a class on the clicked button.
const NAV_SECTIONS = [
  { label: "Main", items: [
    { to: "/", icon: "📊", label: "Dashboard" },
    { to: "/roster", icon: "📅", label: "Shift Roster" },
    { to: "/coverage", icon: "📈", label: "Daily Coverage", permission: ["roster", "read"] },
    { to: "/leave", icon: "🏖", label: "Leave & Absence", permission: ["leave", "read"] },
  ]},
  { label: "Operations", items: [
    { to: "/tools", icon: "🔧", label: "Tool Control", permission: ["tool", "read"] },
    { to: "/stores", icon: "📦", label: "Stores", permission: ["store", "read"] },
    { to: "/quality", icon: "🛡️", label: "Quality / CAPA", permission: ["audit_finding", "read"] },
    { to: "/flights", icon: "✈️", label: "Flights", permission: ["flight", "read"] },
  ]},
  { label: "Records", items: [
    { to: "/staff", icon: "🧑‍🔧", label: "Staff Registry", permission: ["staff", "read"] },
    { to: "/qualifications", icon: "🎓", label: "Qualifications", permission: ["qualification", "read"] },
    { to: "/reports", icon: "📄", label: "Reports", permission: ["reports", "export"] },
    { to: "/history", icon: "🕘", label: "Change History", permission: ["audit_trail", "read"] },
    { to: "/past-rosters", icon: "🗂️", label: "Past Rosters", permission: ["roster", "read"] },
    { to: "/compliance-rules", icon: "⚖️", label: "Compliance Rules" },
  ]},
];

export default function Sidebar() {
  const { user, hasPermission, logout } = useAuth();
  const { needsSwitcher } = useStation();

  return (
    <aside className="sidebar">
      <div className="s-logo">
        <span className="lm">AMD · M&amp;E</span>
        <span className="ln">RosterPro</span>
        <span className="ls">Ahmedabad Line Maintenance</span>
        {needsSwitcher && <div style={{ marginTop: 8 }}><StationSwitcher /></div>}
      </div>
      <nav className="nav">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <div className="nav-sl">{section.label}</div>
            {section.items
              .filter(item => !item.permission || hasPermission(item.permission[0], item.permission[1]))
              .map(item => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `ni${isActive ? " active" : ""}`}>
                  <span className="ni-icon">{item.icon}</span>{item.label}
                </NavLink>
              ))}
          </div>
        ))}
        <div className="nav-sl">Admin</div>
        <button className="ni" onClick={logout}>
          <span className="ni-icon">🔓</span>Sign Out
        </button>
      </nav>
      <div className="s-foot">
        <div className="u-card">
          <div className="u-avatar">{initials(user?.fullName)}</div>
          <div>
            <div className="u-name">{user?.fullName || "Not signed in"}</div>
            <div className="u-role">{user?.roles?.join(", ") || ""}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
