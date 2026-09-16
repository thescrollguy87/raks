import { useCallback } from "react";

// A thin Promise wrapper over the callback-based Geolocation API — no
// existing precedent for this anywhere in the app (first use of
// navigator.geolocation in the codebase). Every call requests a fresh
// high-accuracy fix rather than a cached one (maximumAge: 0): a stale
// cached position is exactly the kind of reading that would make the
// proactive "you're 320m away" distance display lie to someone who has
// since walked closer.
export function useGeolocation() {
  const getPosition = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location services aren't available on this device/browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
        (err) => {
          const messages = {
            1: "Location permission was denied. Enable it in your browser/app settings to punch in.",
            2: "Couldn't determine your location right now. Move to an open area and try again.",
            3: "Getting your location took too long. Try again.",
          };
          reject(new Error(messages[err.code] || err.message || "Couldn't get your location."));
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }, []);

  return { getPosition };
}
