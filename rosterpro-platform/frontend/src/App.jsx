import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/common/ProtectedRoute.jsx";
import AppLayout from "./components/layout/AppLayout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import RosterPage from "./pages/RosterPage.jsx";
import AutoRosterPage from "./pages/AutoRosterPage.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import LeavePage from "./pages/LeavePage.jsx";
import AttendancePage from "./pages/AttendancePage.jsx";
import PunchPage from "./pages/PunchPage.jsx";
import QualificationsPage from "./pages/QualificationsPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import ChangeHistoryPage from "./pages/ChangeHistoryPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import FlightSchedulePage from "./pages/FlightSchedulePage.jsx";
import CoveragePage from "./pages/CoveragePage.jsx";
import CoverageAnalysisPage from "./pages/CoverageAnalysisPage.jsx";
import PastRostersPage from "./pages/PastRostersPage.jsx";
import ComplianceRulesPage from "./pages/ComplianceRulesPage.jsx";
import ImportExportPage from "./pages/ImportExportPage.jsx";
import TenantsPage from "./pages/TenantsPage.jsx";
import BillingPage from "./pages/BillingPage.jsx";
import MyAccountPage from "./pages/MyAccountPage.jsx";
import TaskAllocationGate from "./components/common/TaskAllocationGate.jsx";
import TaskBoardPage from "./pages/taskAllocation/TaskBoardPage.jsx";
import UnassignedTasksPage from "./pages/taskAllocation/UnassignedTasksPage.jsx";
import ConflictsPage from "./pages/taskAllocation/ConflictsPage.jsx";
import AllocationHistoryPage from "./pages/taskAllocation/AllocationHistoryPage.jsx";
import TaskAllocationSettingsPage from "./pages/taskAllocation/TaskAllocationSettingsPage.jsx";

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
        <Route
          path="/leave"
          element={<ProtectedRoute permission={["leave", "read"]}><LeavePage /></ProtectedRoute>}
        />
        <Route
          path="/attendance"
          element={<ProtectedRoute permission={["attendance", "read"]}><AttendancePage /></ProtectedRoute>}
        />
        <Route
          path="/punch"
          element={<ProtectedRoute permission={["attendance", "punch"]}><PunchPage /></ProtectedRoute>}
        />
        <Route path="/my-account" element={<MyAccountPage />} />
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
          path="/history"
          element={<ProtectedRoute permission={["audit_trail", "read"]}><ChangeHistoryPage /></ProtectedRoute>}
        />
        <Route
          path="/flights"
          element={<ProtectedRoute permission={["flight", "read"]}><FlightsPage /></ProtectedRoute>}
        />
        <Route
          path="/flight-schedule"
          element={<ProtectedRoute permission={["roster", "update"]}><FlightSchedulePage /></ProtectedRoute>}
        />
        <Route
          path="/coverage"
          element={<ProtectedRoute permission={["roster", "read"]}><CoveragePage /></ProtectedRoute>}
        />
        <Route
          path="/coverage-analysis"
          element={<ProtectedRoute permission={["roster", "read"]}><CoverageAnalysisPage /></ProtectedRoute>}
        />
        <Route
          path="/past-rosters"
          element={<ProtectedRoute permission={["roster", "read"]}><PastRostersPage /></ProtectedRoute>}
        />
        <Route
          path="/import-export"
          element={<ProtectedRoute permission={["reports", "export"]}><ImportExportPage /></ProtectedRoute>}
        />
        <Route
          path="/tenants"
          element={<ProtectedRoute role="SUPER_ADMIN"><TenantsPage /></ProtectedRoute>}
        />
        <Route
          path="/billing"
          element={<ProtectedRoute permission={["billing", "read"]}><BillingPage /></ProtectedRoute>}
        />

        {/* Task Allocation module — isolated from Rostering, gated by both
            a permission AND the TASK_ALLOCATION_ENABLED feature flag
            (TaskAllocationGate). See taskAllocationRoutes.js on the backend. */}
        <Route
          path="/task-allocation"
          element={<ProtectedRoute permission={["task_allocation", "view"]}><TaskAllocationGate><TaskBoardPage /></TaskAllocationGate></ProtectedRoute>}
        />
        <Route
          path="/task-allocation/board"
          element={<ProtectedRoute permission={["task_allocation", "view"]}><TaskAllocationGate><TaskBoardPage /></TaskAllocationGate></ProtectedRoute>}
        />
        <Route
          path="/task-allocation/unassigned"
          element={<ProtectedRoute permission={["task_allocation", "view"]}><TaskAllocationGate><UnassignedTasksPage /></TaskAllocationGate></ProtectedRoute>}
        />
        <Route
          path="/task-allocation/conflicts"
          element={<ProtectedRoute permission={["task_allocation", "view"]}><TaskAllocationGate><ConflictsPage /></TaskAllocationGate></ProtectedRoute>}
        />
        <Route
          path="/task-allocation/history"
          element={<ProtectedRoute permission={["task_allocation", "view"]}><TaskAllocationGate><AllocationHistoryPage /></TaskAllocationGate></ProtectedRoute>}
        />
        <Route
          path="/task-allocation/settings"
          element={<ProtectedRoute permission={["task_allocation", "settings"]}><TaskAllocationGate><TaskAllocationSettingsPage /></TaskAllocationGate></ProtectedRoute>}
        />
      </Route>
    </Routes>
  );
}
