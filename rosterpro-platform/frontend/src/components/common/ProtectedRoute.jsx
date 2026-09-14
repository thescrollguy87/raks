import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";

export default function ProtectedRoute({ children, permission, anyPermission, role }) {
  const { isAuthenticated, hasPermission, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (permission && !hasPermission(permission[0], permission[1])) {
    return <Navigate to="/" replace />;
  }
  // For routes where either of two distinct resource:action pairs should
  // grant access — e.g. Leave Approvals, reachable via the station-wide
  // leave:approve OR the narrower leave:approve_reports ("L1 Manager").
  if (anyPermission && !anyPermission.some(([resource, action]) => hasPermission(resource, action))) {
    return <Navigate to="/" replace />;
  }
  // For routes gated by role rather than a resource:action permission —
  // e.g. TenantsPage, which lists every airline on the platform and must
  // stay SUPER_ADMIN-only regardless of any permission string.
  if (role && !hasRole(...(Array.isArray(role) ? role : [role]))) {
    return <Navigate to="/" replace />;
  }
  return children;
}
