import { useHeaderState } from "../../store/PageHeaderContext.jsx";

// Matches the prototype's <div class="topbar"><div><div class="topbar-title">
// ...<div class="topbar-sub">...</div></div><div>[actions]</div></div>
// exactly. Content comes from whichever page is currently mounted, via
// usePageHeader() — see store/PageHeaderContext.jsx for why this is a
// context instead of each page rendering its own <TopBar>.
export default function TopBar() {
  const { title, subtitle, actions } = useHeaderState();

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{subtitle}</div>
      </div>
      {actions && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{actions}</div>}
    </div>
  );
}
