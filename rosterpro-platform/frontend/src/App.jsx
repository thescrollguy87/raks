import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/common/ProtectedRoute.jsx";
import AppLayout from "./components/layout/AppLayout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import RosterPage from "./pages/RosterPage.jsx";
import AutoRosterPage from "./pages/AutoRosterPage.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import LeavePage from "./pages/LeavePage.jsx";
import QualificationsPage from "./pages/QualificationsPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import ToolControlPage from "./pages/ToolControlPage.jsx";
import ChangeHistoryPage from "./pages/ChangeHistoryPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import CoveragePage from "./pages/CoveragePage.jsx";
import PastRostersPage from "./pages/PastRostersPage.jsx";
import ComplianceRulesPage from "./pages/ComplianceRulesPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route
          path="/auto-roster"
          element={<ProtectedRoute permission={["roster", "update"]}><AutoRosterPage /></ProtectedRoute>}
        />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/compliance-rules" element={<ComplianceRulesPage />} />
        <Route
          path="/staff"
          element={<ProtectedRoute permission={["staff", "read"]}><StaffPage /></ProtectedRoute>}
        />
        <Route
          path="/qualifications"
          element={<ProtectedRoute permission={["qualification", "read"]}><QualificationsPage /></ProtectedRoute>}
        />
        <Route
          path="/reports"
          element={<ProtectedRoute permission={["reports", "export"]}><ReportsPage /></ProtectedRoute>}
        />
        <Route
          path="/tools"
          element={<ProtectedRoute permission={["tool", "read"]}><ToolControlPage /></ProtectedRoute>}
        />
        <Route
          path="/history"
          element={<ProtectedRoute permission={["audit_trail", "read"]}><ChangeHistoryPage /></ProtectedRoute>}
        />
        <Route
          path="/flights"
          element={<ProtectedRoute permission={["flight", "read"]}><FlightsPage /></ProtectedRoute>}
        />
        <Route
          path="/coverage"
          element={<ProtectedRoute permission={["roster", "read"]}><CoveragePage /></ProtectedRoute>}
        />
        <Route
          path="/past-rosters"
          element={<ProtectedRoute permission={["roster", "read"]}><PastRostersPage /></ProtectedRoute>}
        />
      </Route>
    </Routes>
  );
}
