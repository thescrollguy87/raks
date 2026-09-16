// Mirrors backend/src/utils/geo.js's haversineMeters exactly — kept as a
// small, deliberate duplication (no shared package between frontend/backend
// in this repo) purely so the Punch page can show a live "you're Xm away"
// distance PROACTIVELY, before the user even attempts a punch, without a
// server round-trip on every GPS reading. The backend's own copy is what
// actually enforces the geofence; this one is display-only.
const EARTH_RADIUS_M = 6371000;
function toRad(deg) { return (deg * Math.PI) / 180; }

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestLocation(lat, lng, locations) {
  if (!locations?.length) return null;
  let best = null;
  for (const loc of locations) {
    const distanceM = haversineMeters(lat, lng, loc.latitude, loc.longitude);
    if (!best || distanceM < best.distanceM) best = { location: loc, distanceM };
  }
  return best;
}

// Best-effort only — see the backend's own looksLikeMockLocation for why a
// browser-based PWA fundamentally cannot detect this the way a native app
// can. This is purely a UX nudge to double-check location settings; the
// real enforcement happens server-side.
export function isMobileDevice() {
  const ua = navigator.userAgent || "";
  const isPhoneUA = /Android.*Mobile|iPhone|iPod/i.test(ua);
  const isSmallTouchScreen = (("ontouchstart" in window) || navigator.maxTouchPoints > 0) &&
    Math.min(window.screen.width, window.screen.height) <= 480;
  return isPhoneUA || isSmallTouchScreen;
}
