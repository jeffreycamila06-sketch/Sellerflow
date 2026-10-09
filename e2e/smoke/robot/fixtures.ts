// The robot's shared pieces: a page that records browser errors, a masked screenshot on
// failure, the "open the app as the test seller" step with its safety check, and the
// on-screen text checks (error codes, missing-text keys, technical words).
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { APP_URL, CONSOLE_FILE, CREATED_FILE, secrets } from "./config";
import { assertRobotAccount } from "./account";

const scrub = (s: string): string => {
  let out = String(s || "");
  try { const e = secrets().email; if (e) out = out.split(e).join("[email]").split(e.toLowerCase()).join("[email]"); } catch { /* no secrets: nothing to hide */ }
  return out.slice(0, 500);
};

// Paints over every input and every element whose text shows the signed-in email, then
// screenshots. The email is read inside the page from the app's own session, never passed in.
async function maskedScreenshot(page: Page, info: TestInfo): Promise<void> {
  try {
    await page.evaluate(() => {
      let email = "";
      try { email = (JSON.parse(localStorage.getItem("sf_supabase_auth") || "{}")?.user?.email || "").toLowerCase(); } catch { /* ignore */ }
      document.querySelectorAll("input, textarea").forEach((el) => el.classList.add("sfl-robot-mask"));
      if (!email) return;
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if ((n.textContent || "").toLowerCase().includes(email) && n.parentElement) n.parentElement.classList.add("sfl-robot-mask");
      }
    });
    const png = await page.screenshot({ mask: [page.locator(".sfl-robot-mask")], maskColor: "#222", timeout: 10_000 });
    await info.attach("screen when it failed (inputs and the account email are blacked out)", { body: png, contentType: "image/png" });
  } catch { /* a missing screenshot never hides the real failure */ }
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, provide, info) => {
    // English by default (a test that switches language does it inside the app).
    await page.addInitScript(() => {
      try { if (!sessionStorage.getItem("sfl_robot_lang")) { localStorage.setItem("sfl_rd_lang", "en"); sessionStorage.setItem("sfl_robot_lang", "1"); } } catch { /* ignore */ }
    });
    const title = info.title;
    page.on("pageerror", (err) => appendFileSync(CONSOLE_FILE, JSON.stringify({ test: title, kind: "uncaught", text: scrub(err && err.message) }) + "\n"));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = scrub(msg.text());
      appendFileSync(CONSOLE_FILE, JSON.stringify({ test: title, kind: /^Uncaught/.test(text) ? "uncaught" : "error", text }) + "\n");
    });
    await provide(page);
    if (info.status !== info.expectedStatus) await maskedScreenshot(page, info);
  },
});
export { expect };

// Open the app signed in, check it is the robot's account, wait for the bottom menu.
export async function openApp(page: Page): Promise<void> {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="nav-sales"]').first().waitFor({ timeout: 40_000 });
  await assertRobotAccount(page);
}

// ── On-screen text checks ────────────────────────────────────────────────────────────────
export const visibleText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText || "");

// "E8", "E41:12", "E0" standing alone = a server error code reached the screen.
export function errorCodesIn(text: string): string[] {
  return [...new Set(text.match(/(?<![A-Za-z0-9])E\d{1,3}(?::\S+)?(?![A-Za-z0-9])/g) || [])];
}
// "rd_dash_connect", "lg_rights_p" … = a text key shown instead of its words.
export function missingKeysIn(text: string): string[] {
  return [...new Set(text.match(/\b(?:rd|lg|lp|m_login)_[a-z0-9_]{2,}\b/g) || [])];
}
// Words a seller should never see.
export function technicalWordsIn(text: string): string[] {
  return [...new Set((text.match(/\b(server|token|api|limit|undefined|null|NaN|exception|stack|error code)\b/gi) || []).map((w) => w.toLowerCase()))];
}
// The app's toast (bottom message): its text, or "" when none is showing.
export async function toastText(page: Page): Promise<string> {
  const t = page.locator('[data-testid="app-toast"]');
  return (await t.count()) ? (await t.first().innerText()).trim() : "";
}
// The page did not crash into a blank screen.
export async function expectNotBlank(page: Page, where: string): Promise<void> {
  const text = (await visibleText(page)).trim();
  expect(text.length, `${where}: the screen is blank`).toBeGreaterThan(20);
}

// ── What the robot created (for the final "leftovers" check) ──────────────────────────────
export function noteCreated(what: string, name: string): void {
  appendFileSync(CREATED_FILE, JSON.stringify({ what, name, removed: false }) + "\n");
}
export function noteRemoved(what: string, name: string): void {
  appendFileSync(CREATED_FILE, JSON.stringify({ what, name, removed: true }) + "\n");
}
export function leftovers(): { what: string; name: string }[] {
  if (!existsSync(CREATED_FILE)) return [];
  const state = new Map<string, { what: string; name: string; removed: boolean }>();
  for (const line of readFileSync(CREATED_FILE, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as { what: string; name: string; removed: boolean };
    state.set(`${r.what}|${r.name}`, r);
  }
  return [...state.values()].filter((r) => !r.removed).map(({ what, name }) => ({ what, name }));
}
