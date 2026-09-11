// e2e config — currently just the roster-virtualization scale spec (see
// e2e/roster-virtualization.spec.js). Assumes the backend (port 4000) and
// frontend dev server (port 5173) are already running, same as every
// other live check performed manually during this project's development
// — this config deliberately does NOT start either server itself, so it
// can run against whichever instance (local dev, a staging deploy) the
// caller points it at via E2E_BASE_URL.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: require.resolve("./e2e/global-setup.cjs"),
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
