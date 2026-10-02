// TASK ALLOCATION MODULE — wraps each of its routes so a direct URL visit
// while the feature flag is off redirects home, same as ProtectedRoute does
// for a missing permission. Composed WITH ProtectedRoute in App.jsx, never
// replacing it.
import { Navigate } from "react-router-dom";
import { useTaskAllocationEnabled } from "../../store/TaskAllocationContext.jsx";

export default function TaskAllocationGate({ children }) {
  const { enabled, loading } = useTaskAllocationEnabled();
  if (loading) return <div className="card">Loading…</div>;
  if (!enabled) return <Navigate to="/" replace />;
  return children;
}
