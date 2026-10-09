// SMOKE ROBOT — clicks through the REAL production app as ONE test seller (docs/smoke-robot.md).
//
// Safety rules every test follows:
// • It opens the app with the saved login and first checks the app is signed in to exactly the
//   robot's test account (robot/account.ts) — otherwise it stops and touches nothing.
// • It never opens Admin, never changes the plan, never presses Delete account / Log out, never
//   exports to 7-11, never presses a printer test, never sends a Messenger receipt, and never
//   connects to a real live. The only connect is ONE made-up TikTok name, once per run.
// • What it creates (a product, a made-up TikTok name) it removes with the app's own buttons.
//   The last test lists anything that could not be removed.
// • No database writes of its own: only the app's buttons.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, openApp, visibleText, errorCodesIn, missingKeysIn, technicalWordsIn, toastText, expectNotBlank, noteCreated, noteRemoved, leftovers } from "../robot/fixtures";
import { EN, FIL } from "../robot/strings";
import { navTo, tpl } from "../robot/nav";
import { openHub, openGeneral, openLiveSessionGroup, openChannel } from "../robot/settings";
import { productCard, deleteProductByName, openProductsLoaded } from "../robot/products";
import { ROBOT_TT, slotInputs, slotValues, slotBlock, recentRemoval, markRemoval, tiktokChip, waitForSave, watchSlotLocks } from "../robot/tiktok";
import { watchSwitch } from "../robot/switches";
import { CONNECT_MARK, CONSOLE_FILE, RUN_ID, SERVER_URL } from "../robot/config";
import type { Page } from "@playwright/test";

const note = (text: string): void => { test.info().annotations.push({ type: "note", description: text }); };

// No error code, no text key, not blank — the basic "this screen is fine" check.
async function screenIsFine(page: Page, where: string): Promise<void> {
  await expectNotBlank(page, where);
  const text = await visibleText(page);
  expect(errorCodesIn(text), `${where}: an error code is showing`).toEqual([]);
  expect(missingKeysIn(text), `${where}: text keys show instead of words`).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
test("01 Login works and the Live screen opens with no error", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText(EN.rd_dash_live_comments).first()).toBeVisible();
  await page.waitForTimeout(3000); // let the first loads finish (session, products, switches)
  const toast = await toastText(page);
  expect(toast.startsWith("⚠"), `an error message is showing: "${toast}"`).toBe(false);
  await screenIsFine(page, "Live screen");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("02 Every main screen opens (no crash, no blank page)", async ({ page }) => {
  await openApp(page);
  await test.step("Live", async () => {
    await navTo(page, "live");
    await expect(page.getByText(EN.rd_dash_live_comments).first()).toBeVisible();
    await screenIsFine(page, "Live");
  });
  await test.step("Orders", async () => {
    await navTo(page, "orders");
    await expect(page.getByTestId("orders-tab-orders")).toBeVisible();
    await screenIsFine(page, "Orders");
  });
  await test.step("Products", async () => {
    await navTo(page, "products");
    await expect(page.getByRole("button", { name: EN.rd_prd_add, exact: true })).toBeVisible();
    await screenIsFine(page, "Products");
  });
  await test.step("Sales", async () => {
    await navTo(page, "sales");
    await expect(page.locator('[data-testid^="sales-range-"]').first()).toBeVisible();
    await screenIsFine(page, "Sales");
  });
  await test.step("Settings menu", async () => {
    await openHub(page);
    await screenIsFine(page, "Settings menu");
  });
  await test.step("Customers", async () => {
    await openHub(page);
    await page.getByRole("button", { name: EN.rd_cus_title }).first().click();
    await expect(page.getByPlaceholder(EN.rd_cus_search)).toBeVisible();
    await screenIsFine(page, "Customers");
  });
  await test.step("Shipping", async () => {
    await openHub(page);
    const tile = page.getByRole("button", { name: EN.rd_sh_shipping, exact: true });
    if (!(await tile.count())) { note("Shipping: not shown for this account's market (7-11 is Taiwan only)."); return; }
    await tile.first().click();
    await expect(page.getByTestId("shp-global-fee")).toBeVisible();
    await screenIsFine(page, "Shipping");
  });
  await test.step("General Settings", async () => {
    await openGeneral(page);
    await screenIsFine(page, "General Settings");
  });
  await test.step("Sticker print pattern", async () => {
    await openGeneral(page);
    await openLiveSessionGroup(page);
    await page.getByTestId("ls-print-pattern").click();
    await expect(page.getByTestId("pp-preview-shop")).toBeVisible();
    await screenIsFine(page, "Sticker print pattern");
  });
  await test.step("Printer settings", async () => {
    await openGeneral(page);
    await page.getByRole("button").filter({ has: page.getByText(EN.rd_set_printer, { exact: true }) }).first().click();
    const chooser = page.getByText(EN.rd_set_choose_printer, { exact: true });
    await expect(chooser).toBeVisible();
    await chooser.locator("xpath=following-sibling::button[1]").click();       // the first printer type
    const ok = page.getByTestId("printer-guide-ok");
    if (await ok.isVisible({ timeout: 4000 }).catch(() => false)) await ok.click(); // the short setup guide
    await expect(page.getByText(EN.rd_ps_title, { exact: true }).first()).toBeVisible();
    await screenIsFine(page, "Printer settings");
  });
  await test.step("Subscription (view only)", async () => {
    await openGeneral(page);
    await page.getByRole("button").filter({ has: page.getByText(EN.rd_sub_title, { exact: true }) }).first().click();
    await expect(page.getByText(EN.rd_sub_current, { exact: true })).toBeVisible();
    await screenIsFine(page, "Subscription");
  });
  await test.step("Support", async () => {
    await openGeneral(page);
    await page.getByRole("button").filter({ has: page.getByText(EN.rd_set_support_guide, { exact: true }) }).first().click();
    await expect(page.getByText(EN.rd_sup_title, { exact: true }).first()).toBeVisible();
    await screenIsFine(page, "Support");
  });
  await test.step("Privacy & Terms (in the app)", async () => {
    await openHub(page);
    await page.getByRole("button", { name: EN.lg_pt_title }).first().click();
    await expect(page.getByTestId("lg-terms-link")).toBeVisible();
    await screenIsFine(page, "Privacy & Terms");
  });
  await test.step("Public Privacy and Terms pages", async () => {
    for (const path of ["/privacy/", "/terms/"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} did not open`).toBeLessThan(400);
      await expectNotBlank(page, path);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("03 Language: Filipino and back to English, no missing text", async ({ page }) => {
  await openApp(page);
  await openGeneral(page);
  const langButton = (label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::button[1]");
  await langButton(EN.rd_set_language).click();
  await page.getByRole("button", { name: /Filipino/ }).first().click();
  await expect(page.getByText(FIL.rd_set_language, { exact: true })).toBeVisible();   // "Wika"
  await screenIsFine(page, "General Settings in Filipino");
  // A few screens in Filipino (the bottom menu words are the Filipino ones now).
  for (const words of [FIL.rd_nav_live, FIL.rd_nav_orders, FIL.rd_nav_products]) {
    await page.locator(".sfl-nav").getByRole("button", { name: words, exact: true }).first().click();
    await screenIsFine(page, `${words} in Filipino`);
  }
  // back to English
  await page.locator(".sfl-nav").getByRole("button", { name: FIL.rd_nav_settings, exact: true }).first().click();
  await page.getByRole("button", { name: FIL.rd_sh_general }).first().click();
  await langButton(FIL.rd_set_language).click();
  await page.getByRole("button", { name: /English/ }).first().click();
  await expect(page.getByText(EN.rd_set_language, { exact: true })).toBeVisible();
  await screenIsFine(page, "General Settings back in English");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("04 Products: add a product with a code, see it, change stock, delete it", async ({ page }) => {
  await openApp(page);
  const name = `Robot test product ${RUN_ID}-${test.info().retry}`;
  const code = `ZR${RUN_ID.slice(-4)}${test.info().retry}`;
  // Leftovers of earlier robot runs first (only products named "Robot test product …").
  expect(await openProductsLoaded(page), "the Products list did not load").toBe(true);
  const robotNames = async (): Promise<string[]> => [...new Set((await page.getByText(/^Robot test product /).allInnerTexts()).map((x) => x.trim()))];
  const old = await robotNames();
  if (old.length) {
    for (const o of old) if (!(await deleteProductByName(page, o))) await deleteProductByName(page, o); // one more try
    expect(await openProductsLoaded(page), "the Products list did not load").toBe(true);
    const still = await robotNames();
    for (const n of still) noteCreated("product (left by an earlier run)", n); // test 99 names it
    note(`Found ${old.length} test product(s) left by an earlier run; removed ${old.length - still.length}${still.length ? `; still there: ${still.join(", ")}` : ""}.`);
  }
  let autoTurnedOn = false;

  try {
    await test.step("add the product", async () => {
      await navTo(page, "products");
      await page.getByRole("button", { name: EN.rd_prd_add, exact: true }).click();
      const form = page.locator("form").filter({ hasText: EN.rd_prd_add_title });
      await expect(form).toBeVisible();
      await form.locator("input").first().fill(name);
      await form.getByPlaceholder(EN.rd_prd_live_code_ph).fill(code);
      await form.locator("input[type=number]").nth(0).fill("123");
      await form.locator("input[type=number]").nth(1).fill("2");
      noteCreated("product", name);
      await form.getByRole("button", { name: EN.rd_prd_save, exact: true }).click();
      await expect(form).toBeHidden();
      const card = productCard(page, name);
      await expect(card).toBeVisible();
      await expect(card.getByText(code, { exact: true })).toBeVisible();
      await expect(card.locator('[data-testid^="stock-val-"]')).toHaveText("2");
      await page.waitForTimeout(1500);
      await expect(page.getByText(EN.rd_prd_sync_failed)).toHaveCount(0);
    });
    await test.step("its code shows on the Live screen (Auto mode low-stock chip)", async () => {
      // Auto mode is a per-phone setting: switched on here through Settings like a seller
      // does, and switched back off at the end.
      autoTurnedOn = await setAutoMode(page, true);
      await navTo(page, "live");
      const chip = page.getByText(tpl(EN.rd_auto_lowstock_left, { code, n: 2 }), { exact: true });
      if (!(await chip.isVisible({ timeout: 12_000 }).catch(() => false))) {
        throw new Error(`The product's code ${code} does not show on the Live screen with Auto mode on (${await liveAutoFacts(page)}).`);
      }
    });
    await test.step("change the stock (+1) and see it saved after a reload", async () => {
      await navTo(page, "products");
      const card = productCard(page, name);
      await card.locator('[data-testid^="stock-inc-"]').click();
      await expect(card.locator('[data-testid^="stock-val-"]')).toHaveText("3");
      await page.waitForTimeout(2500);                          // the stock write waits 0.6 s, then saves
      await expect(page.getByText(EN.rd_prd_stock_failed)).toHaveCount(0);
      await openApp(page);
      await navTo(page, "products");
      await expect(productCard(page, name).locator('[data-testid^="stock-val-"]')).toHaveText("3");
    });
    await test.step("delete it and see it stays deleted after a reload", async () => {
      expect(await deleteProductByName(page, name), "the product came back after Delete").toBe(true);
      await openApp(page);
      expect(await openProductsLoaded(page), "the Products list did not load after the reload").toBe(true);
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
      noteRemoved("product", name);
    });
  } finally {
    // Always try (it goes to Products itself; "already gone" counts as removed).
    if (await deleteProductByName(page, name).catch(() => false)) noteRemoved("product", name);
    if (autoTurnedOn) await setAutoMode(page, false).catch(() => false);
  }
});

// Auto mode switch (General Settings → Live session). Turning it ON shows a short
// explanation with "Turn on". Returns true when this call changed it.
async function setAutoMode(page: Page, on: boolean): Promise<boolean> {
  await openGeneral(page);
  await openLiveSessionGroup(page);
  const sw = page.getByTestId("ls-tg-auto");
  if ((await sw.getAttribute("aria-checked")) === String(on)) return false;
  await sw.click();
  if (on) await page.getByRole("button", { name: EN.rd_lss_turn_on, exact: true }).click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
  return true;
}

// What the Live screen shows about Auto mode (product codes only), for a failure message.
async function liveAutoFacts(page: Page): Promise<string> {
  return page.evaluate((tail) => {
    const chips = [...document.querySelectorAll("span")].map((s) => (s.textContent || "").trim()).filter((s) => s.endsWith(tail)).slice(0, 8);
    let auto = "?";
    try { auto = localStorage.getItem("sfl_rd_automode") === "1" ? "on" : "off"; } catch { /* ignore */ }
    const ended = document.querySelector('[data-testid="session-ended"]') ? "yes" : "no";
    return `Auto mode on this browser: ${auto}; low-stock chips shown: ${chips.length ? chips.join(", ") : "none"}; session ended: ${ended}`;
  }, EN.rd_auto_lowstock_left.split("{n}")[1]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
test("05 Orders: one manual order for a made-up buyer", async () => {
  test.skip(true, "Not possible safely: in the app an order can only come from a live comment (1-Click / Type price on a comment), and the app has no button to remove an order again — the robot would leave it behind.");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("06 Sticker preview shows the buyer number, no long number, no error", async ({ page }) => {
  await openApp(page);
  await openGeneral(page);
  await openLiveSessionGroup(page);
  await page.getByTestId("ls-print-pattern").click();
  await expect(page.getByTestId("pp-preview-shop")).toBeVisible();
  await expect(page.getByText(EN.rd_pp_sample_buyer, { exact: true }).first()).toBeVisible(); // "Buyer 12"
  const text = await visibleText(page);
  expect(text.match(/\d{10,}/g) || [], "a long Facebook-style number shows on the sticker screen").toEqual([]);
  await screenIsFine(page, "Sticker preview");
  // The "Printer Test" button is never pressed (it would print).
});

// ─────────────────────────────────────────────────────────────────────────────────────────
async function openShipping(page: Page): Promise<boolean> {
  await openHub(page);
  const tile = page.getByRole("button", { name: EN.rd_sh_shipping, exact: true });
  if (!(await tile.count())) return false;
  await tile.first().click();
  await expect(page.getByTestId("shp-global-fee")).toBeVisible();
  return true;
}
test("07a Shipping screen opens", async ({ page }) => {
  await openApp(page);
  if (!(await openShipping(page))) test.skip(true, "Shipping (7-11) is not shown for this account's market — Taiwan only.");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("shp-load-failed")).toHaveCount(0);
  await screenIsFine(page, "Shipping");
});
test("07b Shipping: open a buyer's form and cancel without saving", async ({ page }) => {
  await openApp(page);
  if (!(await openShipping(page))) test.skip(true, "Shipping (7-11) is not shown for this account's market — Taiwan only.");
  await page.waitForTimeout(1500);
  const open = page.getByRole("button", { name: new RegExp(`^(${EN.rd_shp_add_info}|✓ ${EN.rd_shp_encoded})$`) }).first();
  if (!(await open.count())) test.skip(true, "No buyer in the test account's current session, so there is no form to open (the robot cannot create orders — see test 05).");
  await open.click();
  const phone = page.getByPlaceholder("09xxxxxxxx");
  await expect(phone).toBeVisible();
  await page.getByRole("button", { name: EN.rd_shp_cancel, exact: true }).first().click();   // never "Save"
  await expect(phone).toBeHidden();
  await screenIsFine(page, "Shipping after Cancel");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("08 Facebook settings for a seller without Facebook: plain notice, no dead boxes", async ({ page }) => {
  const switchSeen = watchSwitch(page, "fb_polish_v2");
  await openApp(page);
  await openChannel(page, "facebook");
  if (await page.getByText(EN.rd_fb_channels_title, { exact: true }).first().isVisible({ timeout: 4000 }).catch(() => false)) {
    test.skip(true, "This test account HAS Facebook access (it sees 'Manage Facebook pages') — this check is for sellers without it.");
  }
  await expect(page.getByText(EN.rd_ch_manage_fb_title, { exact: true })).toBeVisible();
  const notice = page.getByTestId("mc-fb-activation");
  const boxes = page.getByText(`${EN.rd_ch_fb_page_label} 1`, { exact: true });
  const boxesFirst = !(await notice.isVisible().catch(() => false)) && (await boxes.count()) > 0;
  // The screen depends on the app's switches, which load when the app opens: wait for them.
  const sw = await switchSeen;
  if (!(await notice.isVisible({ timeout: 8_000 }).catch(() => false)) && (await boxes.count())) {
    const why = sw === false ? "the fb_polish_v2 switch is OFF in production (read from the app's own settings answer)" : sw === true ? "even though the fb_polish_v2 switch is ON" : "the fb_polish_v2 switch could not be read";
    throw new Error(`The old 'Facebook page 1' boxes show instead of the 'activation required' notice — ${why}.`);
  }
  if (boxesFirst) note("Right after the app opened, this screen showed the old 'Facebook page 1' boxes for a moment, until the app's switches had loaded.");
  await expect(notice).toBeVisible();
  await expect(boxes).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
  const text = await visibleText(page);
  expect(technicalWordsIn(text), "technical words on the Facebook screen").toEqual([]);
  await screenIsFine(page, "Facebook settings");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// TikTok: 11a add the made-up name → 12 one "not live" connect → 11b remove the name again.
test("11a TikTok accounts: add a made-up account and see it listed", async ({ page }) => {
  await openApp(page);
  const locksSeen = watchSlotLocks(page);
  await openChannel(page, "tiktok");
  await expect(page.getByText(EN.rd_ch_manage_tt_title, { exact: true })).toBeVisible();
  await screenIsFine(page, "TikTok accounts");
  expect(technicalWordsIn(await visibleText(page)), "technical words on the TikTok accounts screen").toEqual([]);

  const values = await slotValues(page);
  if (values.includes(ROBOT_TT)) { noteCreated("TikTok account (made-up)", ROBOT_TT); note("The made-up account was still there from an earlier run; it is reused and removed in 11b."); return; }
  const inputs = slotInputs(page);
  const locks = (await locksSeen) || new Map<number, Date>();
  let free = -1;
  let lockedFree: Date | null = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] || !(await inputs.nth(i).isEnabled())) continue;
    const until = locks.get(i);
    if (until) { if (!lockedFree || until < lockedFree) lockedFree = until; continue; }   // removed < 4 h ago
    free = i; break;
  }
  if (free < 0 && lockedFree) test.skip(true, `Nothing saved: the only free TikTok account place was emptied less than 4 hours ago, and the app keeps it locked for 4 hours (free again about ${lockedFree.toISOString().slice(11, 16)} UTC). A name added now could not be removed again.`);
  if (free < 0) test.skip(true, "No free TikTok account place on the test account's plan, so the robot cannot add one.");

  await inputs.nth(free).fill(ROBOT_TT);
  await expect(page.getByRole("button", { name: EN.rd_ch_save, exact: true })).toBeVisible();
  const { recent, freeAt } = recentRemoval();
  if (recent) {
    // Inside the 4-hour window: do NOT save (it could not be removed again). Leave without saving.
    await page.getByRole("button", { name: EN.rd_back, exact: true }).first().click();
    await openChannel(page, "tiktok");
    expect(await slotValues(page), "the unsaved name was kept anyway").not.toContain(ROBOT_TT);
    test.skip(true, `Screen checked, nothing saved: the robot removed its made-up account less than 4 hours ago, and the app keeps that place locked for 4 hours (free again about ${freeAt?.toISOString().slice(11, 16)} UTC).`);
  }
  noteCreated("TikTok account (made-up)", ROBOT_TT);
  await page.getByRole("button", { name: EN.rd_ch_save, exact: true }).click();
  const saved = await waitForSave(page);
  if (!saved.ok) {
    const why = saved.said;
    await openChannel(page, "tiktok");
    if (!(await slotValues(page)).includes(ROBOT_TT)) {
      noteRemoved("TikTok account (made-up)", ROBOT_TT);
      test.skip(true, `The app did not save the made-up account${why ? ` — it said: "${why}"` : ""}.`);
    }
  }
  await openChannel(page, "tiktok");
  expect(await slotValues(page), "the made-up account is not listed after Save").toContain(ROBOT_TT);
});

// Never retried: a second try would be a second connect (and would only show "skipped",
// hiding the first try's failure).
test.describe("TikTok connect", () => {
  test.describe.configure({ retries: 0 });
  test("12 TikTok 'not live' answer: one connect to the made-up account", async ({ page }) => {
    if (existsSync(CONNECT_MARK)) test.skip(true, "Already tried once in this run — never retried (protects the live server from a TikTok cooldown that would hit every seller).");
    await openApp(page);
    const chip = tiktokChip(page);
    await expect(chip).toBeVisible();
    await chip.click();
    // an account row in the open menu ("… TikTok · tap to go live"), not the chip itself
    const row = page.getByRole("button").filter({ hasText: ROBOT_TT }).filter({ hasText: EN.rd_dash_tap_go_live }).first();
    if (!(await row.count())) { await chip.click(); test.skip(true, "The made-up TikTok account is not saved (see 11a), so there is nothing safe to connect."); }
    const disconnect = page.getByRole("button", { name: EN.rd_dash_disconnect, exact: true });
    if (await disconnect.count()) { await chip.click(); test.skip(true, "The test account is connected to a live right now — the robot does not touch it."); }
    await row.click();                                                // select the made-up name (no connect yet)
    await expect(chip).toContainText(ROBOT_TT);
    if (!(await page.getByRole("button", { name: EN.rd_dash_connect, exact: true }).isVisible().catch(() => false))) await chip.click();

    writeFileSync(CONNECT_MARK, new Date().toISOString());           // once per run, even if this test is retried
    const seen: string[] = [];
    const watch = (async () => {
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        const t = await toastText(page).catch(() => "");
        if (t && !seen.includes(t)) seen.push(t);
        if (seen.some((s) => s.startsWith("⚠"))) return;
        await page.waitForTimeout(150);
      }
    })();
    await page.getByRole("button", { name: EN.rd_dash_connect, exact: true }).click();
    // No session running → the length picker: the shortest (1 day) session for the test account.
    const picker = page.getByTestId("session-pick-1");
    const switchDialog = page.getByTestId("livesource-switch-overlay");
    const first = await Promise.race([
      picker.waitFor({ timeout: 8000 }).then(() => "picker"),
      switchDialog.waitFor({ timeout: 8000 }).then(() => "switch"),
      page.waitForTimeout(8000).then(() => "none"),
    ]).catch(() => "none");
    if (first === "switch") { await page.getByTestId("livesource-switch-cancel").click(); test.skip(true, "The test account's running session is on another platform; the robot does not switch it."); }
    if (first === "picker") { await picker.click(); note("No session was running, so a 1-day live session was started on the test account (its own data only; it ends by itself)."); }
    await watch;

    const message = seen.find((s) => s.startsWith("⚠")) || "";
    expect(message, "no message appeared after Connect (or it said Connected!)").not.toBe("");
    expect(seen, "the app said Connected! to a made-up account").not.toContain(EN.rd_dash_connected_toast);
    const words = message.replace(/^⚠\s*/, "");
    expect(errorCodesIn(words), `the message shows an error code: "${words}"`).toEqual([]);
    expect(technicalWordsIn(words), `the message has technical words: "${words}"`).toEqual([]);
    expect(missingKeysIn(words), `the message shows a text key: "${words}"`).toEqual([]);
    note(words === EN.rd_cm_not_live ? "The app said: not live (as expected)." : `The app said: "${words}"`);
    // Nothing stays connected.
    await page.waitForTimeout(4000);
    if (!(await page.getByRole("button", { name: EN.rd_dash_connect, exact: true }).isVisible().catch(() => false))) await chip.click();
    await expect(page.getByRole("button", { name: EN.rd_dash_connect, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: EN.rd_dash_disconnect, exact: true })).toHaveCount(0);
  });
});

test("11b TikTok accounts: remove the made-up account again", async ({ page }) => {
  await openApp(page);
  const locksSeen = watchSlotLocks(page);
  await openChannel(page, "tiktok");
  // Until the app has its 4-hour lock answer, it shows every saved name as locked — wait for it.
  const locks = await locksSeen;
  const values = await slotValues(page);
  const i = values.indexOf(ROBOT_TT);
  if (i < 0) test.skip(true, "The made-up account is not saved, so there is nothing to remove.");
  const block = slotBlock(page, i);
  const change = block.getByTestId("mc-change");
  await change.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (!(await change.count())) {
    const until = locks?.get(i);
    if (until) throw new Error(`Could not remove the made-up TikTok account now — that place is locked until about ${until.toISOString().slice(11, 16)} UTC (the app's 4-hour rule). The next run after that removes it.`);
    const lockNote = (await block.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    throw new Error(`Could not remove the made-up TikTok account now — the app shows it LOCKED (${lockNote}). The next run removes it.`);
  }
  await change.click();
  await slotInputs(page).nth(i).fill("");
  await page.getByRole("button", { name: EN.rd_ch_save, exact: true }).click();
  const saved = await waitForSave(page);
  await openChannel(page, "tiktok");
  const after = await slotValues(page);
  if (after.includes(ROBOT_TT)) throw new Error(`The made-up TikTok account is still saved after removing it (the app said: "${saved.said || "nothing"}").`);
  markRemoval();                                                   // its place is locked for 4 hours now
  noteRemoved("TikTok account (made-up)", ROBOT_TT);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("13 Practice comments: Auto order, duplicate, sticker", async () => {
  test.skip(true, "The app's practice-comment feed (+ Test comment / SYNTH) is switched off on www.sellerflowlive.com for every account; adding one would mean changing the app.");
});

// ─────────────────────────────────────────────────────────────────────────────────────────
test("10 Live server health answers exactly {\"ok\":true}", async ({ request }) => {
  const res = await request.get(`${SERVER_URL}/health`, { timeout: 60_000 });
  expect(res.status(), "the live server /health did not answer 200").toBe(200);
  let body: unknown = null;
  try { body = JSON.parse(await res.text()); } catch { /* not JSON */ }
  const keys = body && typeof body === "object" ? Object.keys(body as object).sort().join(", ") : "not JSON";
  expect(body, `/health should answer exactly {"ok":true}; it answers with: ${keys}`).toEqual({ ok: true });
});

test("09 Browser console: no uncaught errors during the whole run", async () => {
  const lines = existsSync(CONSOLE_FILE) ? readFileSync(CONSOLE_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { test: string; kind: string; text: string }) : [];
  const uncaught = lines.filter((l) => l.kind === "uncaught");
  const other = lines.filter((l) => l.kind !== "uncaught");
  if (other.length) note(`${other.length} other console error line(s) (e.g. a refused request) — first: ${other[0].text.slice(0, 120)}`);
  expect(uncaught.map((l) => `${l.test}: ${l.text}`), "uncaught errors in the browser").toEqual([]);
});

test("99 Nothing the robot created is left behind", async () => {
  const left = leftovers();
  expect(left.map((l) => `${l.what} "${l.name}"`), "still there after the run").toEqual([]);
});
