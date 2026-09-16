import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The dev server proxies /api to the backend so the frontend can call
// relative paths ("/api/roster") in both dev and production, instead of
// hardcoding a backend URL that would differ between environments.
export default defineConfig({
  plugins: [
    react(),
    // PWA scaffolding exists ONLY to make the Punch page installable to a
    // phone's home screen and let the app shell itself load offline (so a
    // hangar with no signal at all can still open the Punch screen to
    // queue a punch — see hooks/usePunchQueue.js). The actual "queue a
    // punch offline, sync when connectivity returns" logic deliberately
    // does NOT depend on this service worker or the Background Sync API
    // (patchy support — notably absent on iOS Safari); it's plain
    // IndexedDB + an online/visibility-change listener in application
    // code, which works identically on every platform. generateSW is the
    // simplest workbox strategy and is all the app-shell-caching goal needs.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "RosterPro",
        short_name: "RosterPro",
        description: "Line-maintenance staff rostering, leave, and attendance",
        theme_color: "#2563EB",
        background_color: "#F4F6F9",
        display: "standalone",
        start_url: "/punch",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never let the service worker cache the API itself — attendance
        // data must always be live/queued explicitly, never served stale
        // from an HTTP cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
