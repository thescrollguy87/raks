// Great-circle distance between two lat/lng points, in meters. Standard
// Haversine formula — accurate enough for "is this phone within N meters of
// a hangar" at the scale this app cares about (tens to low-thousands of
// meters), nowhere near where the formula's own small-error assumptions
// would start to matter.
const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Distance to every location, closest first. A punch is valid if it's
// within radius of ANY ONE of them — never require being near all of them.
function rankLocationsByDistance(lat, lng, locations) {
  return locations
    .map(loc => ({ location: loc, distanceM: haversineMeters(lat, lng, loc.latitude, loc.longitude) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

// Best-effort, NOT a security guarantee — flagged explicitly rather than
// pretending otherwise. The Web Geolocation API a PWA runs on has no
// equivalent to native Android's Location.isFromMockProvider(): a rooted/
// spoofed device can report any coordinates with any accuracy it likes, and
// this function cannot see through that. All it catches is the laziest,
// most common spoofing tools' tells — a real GPS chip essentially never
// reports exactly 0m accuracy or an exact-integer accuracy reading, and a
// spoofed point sitting at EXACTLY 0.0m from a configured location (to
// double-precision) is a stronger tell than any real GPS fix, which always
// carries at least a little jitter.
function looksLikeMockLocation({ accuracy, nearestDistanceM }) {
  if (accuracy === null || accuracy === undefined) return false;
  if (accuracy === 0) return true;
  if (Number.isInteger(accuracy) && accuracy <= 5) return true;
  if (nearestDistanceM !== null && nearestDistanceM !== undefined && nearestDistanceM === 0) return true;
  return false;
}

module.exports = { haversineMeters, rankLocationsByDistance, looksLikeMockLocation };
