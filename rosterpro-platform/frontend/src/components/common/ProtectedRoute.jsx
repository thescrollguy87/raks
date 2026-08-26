import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext.jsx";

export default function ProtectedRoute({ children, permission }) {
  const { isAuthenticated, hasPermission } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (permission && !hasPermission(permission[0], permission[1])) {
    return <Navigate to="/" replace />;
  }
  return children;
}
