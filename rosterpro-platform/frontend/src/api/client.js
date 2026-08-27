// Token storage: both tokens live in localStorage so a page reload doesn't
// force a re-login. This is a deliberate simplicity/security tradeoff worth
// revisiting before a wider commercial rollout — httpOnly, secure cookies
// set by the backend would be safer against XSS than anything readable by
// JS, but that requires the backend to issue/read cookies instead of JSON
// tokens (a real change to Module 2's auth endpoints, not just the
// frontend). Flagging this here rather than silently picking the weaker
// option without comment.
const ACCESS_KEY = "rp_access_token";
const REFRESH_KEY = "rp_refresh_token";
const USER_KEY = "rp_user";

export function getAccessToken() { return localStorage.getItem(ACCESS_KEY); }
export function getRefreshToken() { return localStorage.getItem(REFRESH_KEY); }
export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession({ accessToken, refreshToken, user }) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Only one refresh should ever be in flight at a time — if five requests
// 401 simultaneously (e.g. right when the access token expires), they
// should all wait on the SAME refresh call, not each trigger their own
// (which would race and revoke each other's new refresh token, per the
// rotation logic in Module 2's authService).
let refreshPromise = null;
async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new ApiError(401, "Not logged in");
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) { clearSession(); throw new ApiError(401, "Session expired"); }
    const data = await res.json();
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    return data.accessToken;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// Core request function. `raw: true` returns the fetch Response itself
// (used for file downloads where the caller needs the blob/headers, not
// parsed JSON).
async function request(path, { method = "GET", body, query, raw = false } = {}) {
  const url = query ? `${path}?${new URLSearchParams(cleanQuery(query))}` : path;
  const doFetch = (token) => fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await doFetch(getAccessToken());

  // Transparent retry-after-refresh: a caller never has to know their
  // access token expired mid-request — this is the one place that's handled.
  if (res.status === 401 && getRefreshToken()) {
    try {
      const newToken = await refreshAccessToken();
      res = await doFetch(newToken);
    } catch {
      clearSession();
      window.location.href = "/login";
      throw new ApiError(401, "Session expired");
    }
  }

  if (raw) return res;

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText, data?.details);
  }
  return data;
}

function cleanQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

export const api = {
  get: (path, query) => request(path, { method: "GET", query }),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body, query) => request(path, { method: "PATCH", body, query }),
  delete: (path, query) => request(path, { method: "DELETE", query }),
  // Multipart file upload (roster import) — separate from the JSON-only
  // path above since FormData must NOT get a manually-set Content-Type
  // (the browser sets its own boundary) or JSON.stringify'd.
  async upload(path, query, file) {
    const url = query ? `${path}?${new URLSearchParams(cleanQuery(query))}` : path;
    const formData = new FormData();
    formData.append("file", file);
    const doFetch = (token) => fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    let res = await doFetch(getAccessToken());
    if (res.status === 401 && getRefreshToken()) {
      const newToken = await refreshAccessToken().catch(() => null);
      if (!newToken) { clearSession(); window.location.href = "/login"; throw new ApiError(401, "Session expired"); }
      res = await doFetch(newToken);
    }
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.details);
    return data;
  },
  // For file downloads (reports) — returns the Blob and the filename
  // parsed out of the Content-Disposition header the backend sets.
  async download(path, query) {
    const res = await request(path, { method: "GET", query, raw: true });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="(.+)"/);
    return { blob: await res.blob(), filename: match?.[1] || "report" };
  },
};

export { ApiError };
