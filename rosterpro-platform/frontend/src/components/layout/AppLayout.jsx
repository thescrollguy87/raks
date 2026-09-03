import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import BillingBanner from "./BillingBanner.jsx";
import { PageHeaderProvider } from "../../store/PageHeaderContext.jsx";

// Matches the prototype's <div class="app"><aside>...</aside><main
// class="main"><div class="topbar">...</div><div class="content">...
// </div></main></div> structure exactly — TopBar is a fixed-height sibling
// of .content, not nested inside it (see PageHeaderContext.jsx for why).
export default function AppLayout() {
  return (
    <PageHeaderProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <TopBar />
          <BillingBanner />
          <div className="content">
            <Outlet />
          </div>
        </main>
      </div>
    </PageHeaderProvider>
  );
}
