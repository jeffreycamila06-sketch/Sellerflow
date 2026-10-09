// Logs in ONCE, before any test, outside the report (nothing here is traced or recorded),
// then saves the signed-in session to .run/auth.json for the tests. Never uploaded.
//
// SAFETY STOP: right after the login, the robot reads which account the app signed in
// (the app's own saved session). If it is not exactly the E2E_EMAIL account, the run
// stops here — no test runs, nothing is touched. The message never contains the email.
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { APP_URL, AUTH_FILE, RUN_DIR, secrets } from "./config";
import { EN } from "./strings";
import { signedInEmail } from "./account";

export default async function globalSetup(): Promise<void> {
  const { email, password } = secrets();
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });
  const browser = await chromium.launch(process.env.ROBOT_CHROMIUM ? { executablePath: process.env.ROBOT_CHROMIUM } : {});
  try {
    // reducedMotion: the app then switches its looping animations off (a glowing button never
    // "stands still", so it could not be clicked) — the same as a phone with reduce-motion on.
    const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Taipei", viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => { try { if (!localStorage.getItem("sfl_rd_lang")) localStorage.setItem("sfl_rd_lang", "en"); } catch { /* ignore */ } });
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const user = page.locator('input[name="username"]');
    if (!(await user.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: EN.lp_login, exact: true }).first().click({ timeout: 30_000 });
    }
    await user.waitFor({ timeout: 20_000 });
    await user.fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    try {
      await page.locator('[data-testid="nav-sales"]').first().waitFor({ timeout: 45_000 });
    } catch {
      throw new Error("Smoke robot: the login did not reach the app (wrong password, blocked account, or the site is down). Nothing was touched.");
    }
    const who = await signedInEmail(page);
    if (!who || who !== email.toLowerCase()) {
      throw new Error("SAFETY STOP: the app is signed in to a different account than the robot's test account. Nothing was touched.");
    }
    await context.storageState({ path: AUTH_FILE });
    writeFileSync(`${RUN_DIR}/account-ok`, "1");
  } finally {
    await browser.close();
  }
}
