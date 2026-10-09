// TikTok helpers. The robot only ever uses ONE made-up account name, always the same, so it
// can recognise (and remove) its own leftover from an earlier run. It never touches the test
// seller's other TikTok names.
//
// Why the 4-hour memory: adding a name locks nothing, but REMOVING it locks that list place
// for 4 hours (the app's username cooldown). A second run inside those 4 hours could add the
// name but not remove it again. So after a removal the robot writes the time to .state/ (kept
// between runs by the workflow's cache), and inside 4 hours it only tries the screen without
// saving and skips the connect check — nothing is left behind.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { EN } from "./strings";

export const ROBOT_TT = "sfl_robot_x7q9z_notlive"; // made up; no real seller or creator uses it
export const LOCK_MS = 4 * 60 * 60 * 1000 + 5 * 60 * 1000;

const STATE_DIR = join(__dirname, "..", ".state");
const STATE_FILE = join(STATE_DIR, "tiktok-removed-at");

export function lastRemovalMs(): number | null {
  try { const n = Date.parse(readFileSync(STATE_FILE, "utf8").trim()); return Number.isFinite(n) ? n : null; } catch { return null; }
}
export function recentRemoval(now = Date.now()): { recent: boolean; freeAt: Date | null } {
  const at = lastRemovalMs();
  if (at == null || now - at >= LOCK_MS) return { recent: false, freeAt: null };
  return { recent: true, freeAt: new Date(at + LOCK_MS) };
}
export function markRemoval(now = Date.now()): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, new Date(now).toISOString());
}

// The account-name boxes on "Manage TikTok channels" (inputs without a type).
export const slotInputs = (page: Page): Locator => page.locator('input:not([type])');
export async function slotValues(page: Page): Promise<string[]> {
  return slotInputs(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value.trim().replace(/^@/, "")));
}
// One slot's block (label + box + its Change / LOCKED / notes).
export const slotBlock = (page: Page, index: number): Locator =>
  slotInputs(page).nth(index).locator('xpath=ancestor::div[.//label][1]');

// The app's own words for "could not save the accounts" (static part before any {value}).
export function saveErrorShown(text: string): string {
  for (const k of ["rd_ch_cooldown_err", "rd_ch_save_failed", "rd_acct_locked", "rd_acct_limit", "rd_acct_limit_generic"]) {
    const head = String(EN[k] || "").split("{")[0].trim();
    if (head && text.includes(head)) return EN[k];
  }
  return "";
}

// The TikTok chip on the Live screen (its small "t" badge tells it from the Facebook chip).
// Since Build 14 the chip row shows only while 2+ sources are live; otherwise the Live picker.
export const tiktokChip = (page: Page): Locator =>
  page.locator("button").filter({ has: page.locator("span", { hasText: /^t$/ }) }).first();

// The TikTok account menu on the Live screen, wherever the app shows it (Build 14):
//   • the Live picker (nothing live, empty board): the TikTok tile → its account panel;
//   • "Choose live source" (nothing live, the board still has comments) → the same picker;
//   • the old chip row (2+ sources live) → the TikTok chip's dropdown.
// One source already live (one header button) → { skip }: the robot never touches a live.
// The menu holds the SAME rows and Connect button in every case.
export type TikTokMenu = {
  how: "picker" | "chip";
  menu: Locator;                          // where the account rows + Connect are
  ensureOpen: () => Promise<void>;        // open it again if the app closed it
  close: () => Promise<void>;
  isSelected: (name: string) => Promise<boolean>;
};
export async function openTikTokMenu(page: Page): Promise<TikTokMenu | { skip: string }> {
  const tile = page.getByTestId("lpk-tile-tt");
  const choose = page.getByTestId("lpk-choose-button");
  const live = page.getByTestId("lpk-source-button");
  const chip = tiktokChip(page);
  // Which one is on screen (the tile is checked before the chip: the tile's emblem is also a "t").
  let first = "";
  for (const until = Date.now() + 10_000; !first && Date.now() < until; await page.waitForTimeout(200)) {
    if (await live.count()) first = "live";
    else if (await tile.count()) first = "tile";
    else if (await choose.count()) first = "choose";
    else if (await page.getByTestId("livesource-button").count()) first = "livesource";
    else if (await chip.count()) first = "chip";
  }
  if (!first) throw new Error("The Live screen shows neither the Live picker nor the TikTok chip.");
  if (first === "live") return { skip: "The test account is connected to a live right now — the robot does not touch it." };
  if (first === "livesource") return { skip: "The test account has the single 'Live source' button (live_source preview), not the Live picker — the robot only knows the picker and the old chips." };
  if (first === "tile" || first === "choose") {
    const panel = page.getByTestId("lpk-panel-tt");
    const ensureOpen = async (): Promise<void> => {
      if (await panel.count()) return;
      // Still chosen (e.g. "Connecting…" hides the panel for a moment): wait — tapping the
      // chosen tile again would mean Back.
      if ((await tile.count()) && (await tile.getAttribute("aria-expanded")) === "true") { await panel.waitFor({ timeout: 15_000 }); return; }
      if (await choose.isVisible().catch(() => false)) await choose.click();
      await tile.click();
      await panel.waitFor();
    };
    await ensureOpen();
    return {
      how: "picker", menu: panel, ensureOpen,
      close: async () => { if (await panel.count()) await tile.click(); },   // the chosen tile again = Back
      isSelected: async (name) => /✓\s*$/.test((await panel.getByRole("button").filter({ hasText: name }).first().innerText()).trim()),
    };
  }
  const ensureOpen = async (): Promise<void> => {
    if (!(await page.getByRole("button", { name: EN.rd_dash_connect, exact: true }).or(page.getByRole("button", { name: EN.rd_dash_disconnect, exact: true })).count())) await chip.click();
  };
  await chip.click();
  return {
    how: "chip", menu: page.locator("body"), ensureOpen,
    close: async () => { await chip.click(); },
    isSelected: async (name) => ((await chip.innerText()) || "").includes(name),
  };
}

// After pressing Save: the app reloads the account, so the short "Saved" note can vanish at
// once. A good save = the Save button goes away (nothing left to save). A refused save =
// the button stays and one of the app's "could not save" sentences shows.
export async function waitForSave(page: Page, timeoutMs = 15_000): Promise<{ ok: boolean; said: string }> {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const save = page.getByRole("button", { name: new RegExp(`^(${esc(EN.rd_ch_save)}|${esc(EN.rd_set_saving)})$`) });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const said = saveErrorShown(await page.evaluate(() => document.body.innerText || "").catch(() => ""));
    if (said) return { ok: false, said };
    if (!(await save.count())) return { ok: true, said: "" };
    await page.waitForTimeout(200);
  }
  return { ok: false, said: "" };
}

// The app itself reads this account's 4-hour locks when the TikTok accounts screen opens.
// The robot only WATCHES that answer (no extra request): place number → when it is free
// again. Empty map = nothing locked (or the answer was not seen; the .state memory above
// still applies then).
export function watchSlotLocks(page: Page): Promise<Map<number, Date> | null> {
  return page
    .waitForResponse((r) => r.url().includes("/rest/v1/rpc/tiktok_slot_cooldowns") && r.request().method() === "POST", { timeout: 20_000 })
    .then(async (r) => {
      const rows = (await r.json().catch(() => [])) as Array<{ platform?: string; slot_index?: number; last_changed_at?: string; server_now?: string }>;
      const out = new Map<number, Date>();
      if (!Array.isArray(rows)) return out;
      for (const row of rows) {
        if (row.platform !== "tiktok" || row.slot_index == null || !row.last_changed_at) continue;
        const now = Date.parse(row.server_now || "") || Date.now();
        const freeAt = Date.parse(row.last_changed_at) + 4 * 60 * 60 * 1000;
        if (freeAt > now) out.set(Number(row.slot_index), new Date(freeAt + 5 * 60 * 1000));
      }
      return out;
    })
    .catch(() => null);
}
