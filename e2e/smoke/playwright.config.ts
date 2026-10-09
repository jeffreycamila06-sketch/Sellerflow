// Smoke robot — Playwright config (docs/smoke-robot.md).
// One browser (Chromium), one worker, tests in file order, one retry.
// NOTHING that could hold a secret is recorded: no trace, no video, no automatic
// screenshot. A failed test attaches ONE screenshot taken by the robot itself with every
// input and every place showing the signed-in email painted over (fixtures.ts).
// The login happens in global-setup.ts, outside the report; its saved session lives in
// .run/ (never uploaded — the workflow uploads playwright-report/ only, and deletes .run/).
import { defineConfig, devices } from "@playwright/test";
import { APP_URL, AUTH_FILE } from "./robot/config";

export default defineConfig({
  testDir: "./tests",
  timeout: 75_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["./robot/summary-reporter.ts"]],
  // The whole run stops after 6 minutes (the workflow job, installs included, stops at 10).
  globalTimeout: 6 * 60_000,
  globalSetup: "./robot/global-setup.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: APP_URL,
    storageState: AUTH_FILE,
    trace: "off",
    video: "off",
    screenshot: "off",
    locale: "en-US",
    timezoneId: "Asia/Taipei",
    viewport: { width: 1280, height: 900 },
    // The app turns its looping animations off for reduce-motion (same as such a phone);
    // otherwise animated buttons never "stand still" long enough to be clicked.
    contextOptions: { reducedMotion: "reduce" },
    actionTimeout: 12_000,
    navigationTimeout: 30_000,
    // Chromium path override for a local dry run only (never set in the workflow).
    ...(process.env.ROBOT_CHROMIUM ? { launchOptions: { executablePath: process.env.ROBOT_CHROMIUM } } : {}),
  },
  projects: [{ name: "chromium" }],
});
