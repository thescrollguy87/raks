import { api, setSession, clearSession, getRefreshToken } from "./client.js";

export async function login(email, password, mfaCode) {
  const data = await api.post("/api/auth/login", { email, password, mfaCode });
  setSession(data);
  return data.user;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  clearSession();
  if (refreshToken) {
    // Best-effort — the user is logged out locally regardless of whether
    // this network call succeeds, so no error handling needed here.
    api.post("/api/auth/logout", { refreshToken }).catch(() => {});
  }
}

export function forgotPassword(email) {
  return api.post("/api/auth/forgot-password", { email });
}

export function resetPassword(token, newPassword) {
  return api.post("/api/auth/reset-password", { token, newPassword });
}

export function me() {
  return api.get("/api/auth/me");
}
