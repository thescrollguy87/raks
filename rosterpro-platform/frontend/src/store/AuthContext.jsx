import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { getAccessToken, getStoredUser } from "../api/client.js";
import * as authApi from "../api/auth.js";

// The access token itself carries the user's permission list (see Module
// 2's authService.signAccessToken) — decoding it here means the frontend's
// permission checks stay in sync with the backend's RBAC without a
// separate "who am I allowed to do what" API call on every page load.
function decodeToken(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [claims, setClaims] = useState(() => {
    const token = getAccessToken();
    return token ? decodeToken(token) : null;
  });

  const login = useCallback(async (email, password, mfaCode) => {
    const loggedInUser = await authApi.login(email, password, mfaCode);
    setUser(loggedInUser);
    setClaims(decodeToken(getAccessToken()));
    return loggedInUser;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setClaims(null);
  }, []);

  // Mirrors the prototype's "editor-only" class / the backend's
  // requirePermission("resource","action") — one function, used both to
  // conditionally render UI (hide the Add Shift button) and to decide
  // whether to even attempt an action that the backend would reject anyway.
  const hasPermission = useCallback((resource, action) => {
    if (!claims) return false;
    if (claims.roles?.includes("SUPER_ADMIN")) return true;
    return claims.permissions?.includes(`${resource}:${action}`) ?? false;
  }, [claims]);

  const hasRole = useCallback((...roles) => {
    return roles.some(r => claims?.roles?.includes(r));
  }, [claims]);

  const value = useMemo(() => ({
    user, claims, isAuthenticated: !!user,
    login, logout, hasPermission, hasRole,
  }), [user, claims, login, logout, hasPermission, hasRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
