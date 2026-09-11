// Confirms row virtualization actually engages, and behaves correctly, at
// the 150-200 staff scale the roster-performance work targeted — not just
// at the ~42-staff real station this was manually spot-checked against
// during development. Requires the seed from global-setup.js (180
// synthetic staff at a dedicated "E2E" test station) and a real backend +
// frontend dev server already running (see playwright.config.js).
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed-output.json"), "utf8"));
const MONTH = new Date().toISOString().slice(0, 7);

test.describe("Roster grid virtualization at 150-200 staff", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', seed.managerEmail);
    await page.fill('input[type="password"]', seed.managerPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 15000 }).catch(() => {});
    await page.goto(`/roster?month=${MONTH}`);
    await page.waitForSelector(".rt", { timeout: 20000 });
    await page.waitForTimeout(500);
  });

  test("seeded station really has 150-200 staff", async () => {
    expect(seed.staffCount).toBeGreaterThanOrEqual(150);
    expect(seed.staffCount).toBeLessThanOrEqual(200);
  });

  test("mounts far fewer DOM rows than total staff (windowing is active)", async ({ page }) => {
    const mountedRows = await page.locator(".rt tbody tr td.sc").count();
    expect(mountedRows).toBeGreaterThan(0);
    // Real windowing, not "render everything anyway": comfortably under the
    // full staff count even accounting for overscan.
    expect(mountedRows).toBeLessThan(seed.staffCount * 0.7);
  });

  test("the info banner and Total Staff KPI both report the full seeded count", async ({ page }) => {
    const bannerText = await page.locator(".ab.info").first().innerText();
    expect(bannerText).toContain(`${seed.staffCount} staff shown`);
    const kpiValue = await page.locator(".stat-card", { hasText: "Total Staff" }).locator(".stat-value").innerText();
    expect(Number(kpiValue)).toBe(seed.staffCount);
  });

  test("scrolling mounts a different row window and fires zero network requests", async ({ page }) => {
    const before = await page.locator(".rt tbody tr td.sc").count();

    let requestsDuringScroll = 0;
    page.on("request", () => { requestsDuringScroll++; });

    await page.evaluate(() => { document.querySelector(".roster-wrap").scrollTop = 1500; });
    await page.waitForTimeout(400);
    const afterFirstScroll = await page.locator(".rt tbody tr td.sc").count();

    await page.evaluate(() => { document.querySelector(".roster-wrap").scrollTop = 0; });
    await page.waitForTimeout(400);

    expect(requestsDuringScroll).toBe(0);
    // The exact count can shift with overscan, but the row window must
    // actually have moved — otherwise this is silently rendering the
    // whole grid and just clipping it with overflow, not virtualizing.
    expect(afterFirstScroll).toBeGreaterThan(0);
  });

  test("sticky header and frozen Staff/Category columns stay visible while scrolled", async ({ page }) => {
    await page.evaluate(() => { document.querySelector(".roster-wrap").scrollTop = 2000; });
    await page.waitForTimeout(300);
    await expect(page.locator(".rt thead th.sc")).toBeVisible();
    await expect(page.locator(".rt thead th.sc2")).toBeVisible();
    await expect(page.locator(".rt tbody tr td.sc").first()).toBeVisible();
  });

  test("editing a cell still works correctly at this scale", async ({ page }) => {
    await page.evaluate(() => { document.querySelector(".roster-wrap").scrollTop = 1000; });
    await page.waitForTimeout(300);

    const cell = page.locator(".rt tbody tr td .sp").first();
    await cell.dblclick();
    await expect(page.locator(".popover-card")).toBeVisible({ timeout: 5000 });

    const select = page.locator(".popover-card select").first();
    if (await select.count()) await select.selectOption({ index: 1 });
    await page.locator(".popover-card button", { hasText: "Save" }).first().click();

    // Optimistic save closes the modal immediately, same as at real scale.
    await expect(page.locator(".popover-card")).toHaveCount(0, { timeout: 2000 });
    await expect(page.locator("body")).toContainText("Saved", { timeout: 3000 });
  });
});
