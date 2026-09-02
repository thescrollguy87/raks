import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";

export default function ProtectedRoute({ children, permission, role }) {
  const { isAuthenticated, hasPermission, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (permission && !hasPermission(permission[0], permission[1])) {
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
