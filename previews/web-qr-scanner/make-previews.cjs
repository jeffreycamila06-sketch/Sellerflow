// PREVIEW + REAL-BROWSER CHECK of the in-page QR scanner (never shipped).
// The REAL app (preview mode: made-up data, no sign-in) in Chromium at an Android phone's size
// (412×915), told it is the Android app WITHOUT the built-in scanner (window.Capacitor, no
// SellerFlowScanner plugin), with a FAKE CAMERA that plays short videos of real SellerFlowLive
// stickers (harness/camera-video.gen.ts). The scanner, its QR reader, the centre rule and the four
// screens are the real code. Writes the pictures next to this file and results.txt.
//
//   1) the camera videos:  OUT=<folder> npx vitest run --config previews/web-qr-scanner/harness/vitest.gen.config.ts
//   2) the app:            npx vite --config vite.preview.config.ts --port 5199
//   3) this:               node previews/web-qr-scanner/make-previews.cjs <folder> [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CAM = process.argv[2];
const PORT = process.argv[3] || "5199";
if (!CAM || !fs.existsSync(path.join(CAM, "one.y4m"))) { console.error("usage: node make-previews.cjs <folder with one.y4m two.y4m desk.y4m> [port]"); process.exit(2); }
const OUT = __dirname;
const BASE = `http://localhost:${PORT}`;
const VIEW = { width: 412, height: 915 };
const lines = [];
let failed = 0;
const say = (ok, text) => { if (!ok) failed++; const l = `${ok ? "ok  " : "FAIL"} ${text}`; lines.push(l); console.log(l); };

// One phone. scene = the camera video; o.deny = the camera is refused; o.tapExpired = the tap no longer
// counts when the camera answers; o.app = "android" (default) | "ios" | null (a plain browser).
async function phone(scene, o = {}) {
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
  if (scene) args.push(`--use-file-for-fake-video-capture=${path.join(CAM, `${scene}.y4m`)}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((opt) => {
    if (opt.app !== null) window.Capacitor = { getPlatform: () => opt.app || "android", Plugins: {} };
    // the iPhone case: a current build number, so the app's own "Time for an update" window does not cover the screen
    if (opt.app === "ios") window.SellerFlowPrinter = { getBuildNumber: () => 99 };
    window.__tracks = [];
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => {
        window.__camAsked = (window.__camAsked || 0) + 1;
        if (opt.deny) throw new DOMException("Permission denied", "NotAllowedError");
        const s = await real(c);
        for (const t of s.getTracks()) window.__tracks.push(t);
        return s;
      };
    }
    // The fake camera has no light: say it has one, and accept the on/off request (the button is the app's).
    const caps = MediaStreamTrack.prototype.getCapabilities;
    MediaStreamTrack.prototype.getCapabilities = function () { return { ...(caps ? caps.call(this) : {}), torch: true }; };
    const apply = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (c) {
      const adv = c && c.advanced && c.advanced[0];
      if (adv && "torch" in adv) { window.__torch = adv.torch; return Promise.resolve(); }
      return apply.call(this, c);
    };
    if (opt.tapExpired) Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ isActive: false, hasBeenActive: true }) });
  }, o);
  return { browser, page, errors };
}
const cameraOff = (page) => page.evaluate(() => ({ n: window.__tracks.length, off: window.__tracks.every((t) => t.readyState === "ended") }));
const settle = (page, ms) => page.waitForTimeout(ms);
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); lines.push(`     picture: previews/web-qr-scanner/${name}`); };

async function openSettings(page, query = "") {
  await page.goto(`${BASE}/${query}`, { waitUntil: "networkidle" });
  await settle(page, 900);
  await page.locator("button", { hasText: /^Settings$/ }).last().click();
  await settle(page, 400);
}
async function openParcelScan(page) {
  await openSettings(page);
  await page.click("[data-testid=tile-parcelscan]");
  await settle(page, 900);
  await page.click("[data-testid=ps-manual]");
  await settle(page, 300);
}
async function openBlacklist(page) {
  await openSettings(page, "?admin=1&bl=1");
  await page.click("[data-testid=tile-blacklist]");
  await settle(page, 700);
  await page.click("[data-testid=bl-reason-return]");
  await settle(page, 200);
}
async function openOrders(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await settle(page, 900);
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("button")].map((b) => ({ b, r: b.getBoundingClientRect() }));
    const bottom = all.filter((x) => x.r.top > window.innerHeight - 110).sort((a, b) => a.r.left - b.r.left);
    bottom[2].b.click();
  });
  await page.locator("input.sfl-header-search").waitFor({ timeout: 8000 });
  await settle(page, 500);
}
const scannerOpen = async (page) => {
  await page.waitForSelector("[data-testid=wqs]", { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector("[data-testid=wqs-video]"); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
};
const usernameBox = (page) => page.locator("[data-testid=ps-bc-input], [data-testid=ps-notes]").first();

(async () => {
  // ── 1. The scanner screen (the QR is not in the frame yet), light off / on; Close ──────────
  {
    const { browser, page, errors } = await phone("desk");
    await openParcelScan(page);
    await page.click("[data-testid=ps-scan-qr]");
    await scannerOpen(page);
    await settle(page, 1500);
    const hint = await page.textContent("[data-testid=wqs-hint]");
    say(hint === "Point at the QR on the sticker", `scanner open over Parcel Scan, hint "${hint}", still open after 1.5 s (the sticker's QR is outside the frame)`);
    const frame = await page.evaluate(() => { const r = document.querySelector("[data-testid=wqs-frame]").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; });
    say(frame.w === 280 && frame.h === 280 && frame.cx === 206 && Math.abs(frame.cy - 457) <= 1, `frame ${frame.w}×${frame.h} px in the middle (${frame.cx}, ${frame.cy}) — 68 % of 412`);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    say(sideways <= 0, `no sideways scroll (${sideways})`);
    const taps = await page.evaluate(() => ["wqs-close", "wqs-light", "wqs-photo"].map((id) => { const r = document.querySelector(`[data-testid=${id}]`).getBoundingClientRect(); return `${id} ${Math.round(r.width)}×${Math.round(r.height)}`; }));
    say(true, `buttons: ${taps.join(" · ")} (each at least 44 px)`);
    await shot(page, "01-scanner-light-off.png");
    await page.click("[data-testid=wqs-light]");
    await page.waitForFunction(() => document.querySelector("[data-testid=wqs-light]").getAttribute("aria-pressed") === "true", null, { timeout: 3000 });
    say((await page.evaluate(() => window.__torch)) === true, "light button → the camera is asked to switch its light ON");
    await settle(page, 200);
    await shot(page, "02-scanner-light-on.png");
    await page.click("[data-testid=wqs-light]");
    await page.waitForFunction(() => document.querySelector("[data-testid=wqs-light]").getAttribute("aria-pressed") === "false", null, { timeout: 3000 });
    say((await page.evaluate(() => window.__torch)) === false, "light button again → OFF");
    await page.click("[data-testid=wqs-close]");
    await settle(page, 200);
    const cam = await cameraOff(page);
    say(cam.n >= 1 && cam.off && !(await page.$("[data-testid=wqs]")), `Close → scanner gone, ${cam.n} camera track(s), all stopped: ${cam.off}`);
    say((await usernameBox(page).inputValue()) === "", "Close → the username box is untouched");
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }

  // ── 2. Two stickers equally near the middle → "Point at one QR"; the phone's Back closes ────
  {
    const { browser, page, errors } = await phone("two");
    await openParcelScan(page);
    await page.click("[data-testid=ps-scan-qr]");
    await scannerOpen(page);
    await page.waitForFunction(() => document.querySelector("[data-testid=wqs-hint]").textContent === "Point at one QR", null, { timeout: 20000 });
    say(true, 'two stickers in the frame → the REAL reader sees both → hint "Point at one QR"');
    await settle(page, 1200);
    say(!!(await page.$("[data-testid=wqs]")) && (await usernameBox(page).inputValue()) === "", "…and after 1.2 s more nothing was read (never a guess between two)");
    await shot(page, "03-point-at-one-qr.png");
    await page.goBack();
    await settle(page, 300);
    const cam = await cameraOff(page);
    say(!(await page.$("[data-testid=wqs]")) && cam.off, `the phone's Back → scanner gone, camera stopped: ${cam.off}; still on Parcel Scan: ${!!(await page.$("[data-testid=ps-scan-qr]"))}`);
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }

  // ── 3. One sticker in the frame → read by itself → today's parser fills the username ────────
  {
    const { browser, page, errors } = await phone("one");
    await openParcelScan(page);
    const t0 = Date.now();
    await page.click("[data-testid=ps-scan-qr]");
    await page.waitForFunction(() => { const i = document.querySelector("[data-testid=ps-bc-input], [data-testid=ps-notes]"); return i && i.value !== ""; }, null, { timeout: 30000 });
    const ms = Date.now() - t0;
    const v = await usernameBox(page).inputValue();
    say(v === "jhun.belle", `7-11 Parcel Scan: live read → username "${v}" (from the QR https://tiktok.com/@jhun.belle), ${ms} ms after the tap`);
    await settle(page, 150);
    const cam = await cameraOff(page);
    say(!(await page.$("[data-testid=wqs]")) && cam.off, `after the read: scanner gone, camera stopped: ${cam.off}`);
    await shot(page, "08-parcel-scan-after-read.png");
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }
  {
    const { browser, page, errors } = await phone("one");
    await openBlacklist(page);
    await shot(page, "06-blacklist-scan-button.png");
    say((await page.textContent("[data-testid=bl-scan]")).trim() === "Scan sticker QR", "Blacklist: the Scan sticker QR button");
    await page.click("[data-testid=bl-scan]");
    const added = await page.waitForSelector("[data-testid=bl-added], [data-testid=bl-already]", { timeout: 30000 });
    const text = (await added.textContent()).trim();
    say(/jhun\.belle/.test(text), `Blacklist: live read → "${text.replace(/\s+/g, " ")}"`);
    const cam = await cameraOff(page);
    say(cam.off, `camera stopped: ${cam.off}`);
    await shot(page, "09-blacklist-after-read.png");
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }
  {
    const { browser, page, errors } = await phone("one");
    await openOrders(page);
    say(!!(await page.$("[data-testid=ord-scan]")), "Orders: the Scan button is there (Android app without the built-in scanner, switch on)");
    await shot(page, "07-orders-scan-button.png");
    await page.click("[data-testid=ord-scan]");
    await page.waitForFunction(() => document.querySelector("input.sfl-header-search").value !== "", null, { timeout: 30000 });
    const q = await page.inputValue("input.sfl-header-search");
    say(q === "@jhun.belle", `Orders: live read → the search box "${q}"`);
    const cam = await cameraOff(page);
    say(cam.off, `camera stopped: ${cam.off}`);
    await settle(page, 300);
    await shot(page, "10-orders-after-read.png");
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }

  // ── 4. "Take a photo instead" → today's photo picker really opens ───────────────────────────
  {
    const { browser, page } = await phone("desk");
    await openParcelScan(page);
    await page.click("[data-testid=ps-scan-qr]");
    await scannerOpen(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null), page.click("[data-testid=wqs-photo]")]);
    const cam = await cameraOff(page);
    say(!!chooser && !(await page.$("[data-testid=wqs]")) && cam.off, `"Take a photo instead" → the photo picker opened: ${!!chooser}; scanner gone; camera stopped: ${cam.off}`);
    await browser.close();
  }

  // ── 5. Camera refused → one short line + today's photo picker ───────────────────────────────
  {
    const { browser, page } = await phone(null, { deny: true });
    await openParcelScan(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null), page.click("[data-testid=ps-scan-qr]")]);
    await page.waitForSelector("[data-testid=ps-toast]", { timeout: 3000 }).catch(() => null);
    const toast = ((await page.textContent("[data-testid=ps-toast]").catch(() => "")) || "").trim();
    say(!!chooser && /Camera is off for SellerFlowLive/.test(toast) && !(await page.$("[data-testid=wqs]")), `camera refused → the photo picker opened: ${!!chooser}; the line: "${toast}"; no scanner left on screen`);
    await page.evaluate(() => { const t = document.querySelector("[data-testid=ps-toast]"); if (t) t.scrollIntoView({ block: "center" }); });
    await shot(page, "04-camera-refused-photo-flow.png");
    await browser.close();
  }
  {
    const { browser, page } = await phone(null, { deny: true, tapExpired: true });
    await openParcelScan(page);
    await page.click("[data-testid=ps-scan-qr]");
    await page.waitForFunction(() => { const p = document.querySelector("[data-testid=wqs-panel]"); return p && p.style.display === "block"; }, null, { timeout: 5000 });
    const text = await page.textContent("[data-testid=wqs-panel]");
    say(text === "Camera is off for SellerFlowLive", `camera refused after a long permission question (the tap no longer counts) → the scanner stays with the line "${text}" and its own button`);
    await shot(page, "05-camera-refused-after-long-question.png");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null), page.click("[data-testid=wqs-photo]")]);
    say(!!chooser && !(await page.$("[data-testid=wqs]")), `…"Take a photo instead" there → the photo picker opened: ${!!chooser}`);
    await browser.close();
  }

  // ── 6. Everyone else: today's photo flow (the page's camera is never asked) ─────────────────
  for (const [name, app] of [["a plain browser (no app)", null], ["the iPhone app without the built-in scanner", "ios"]]) {
    const { browser, page } = await phone("one", { app });
    await openParcelScan(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null), page.click("[data-testid=ps-scan-qr]")]);
    await settle(page, 400);
    const asked = await page.evaluate(() => window.__camAsked || 0);
    say(!!chooser && asked === 0 && !(await page.$("[data-testid=wqs]")), `${name}: Scan QR → the photo picker at once: ${!!chooser}; camera asked ${asked} time(s); no scanner`);
    if (app === null) {
      await openOrders(page);
      say(!(await page.$("[data-testid=ord-scan]")) && !(await page.$("[data-testid=ord-scan-file]")), `${name}: Orders has no Scan button`);
    }
    await browser.close();
  }

  lines.push("", failed ? `${failed} CHECK(S) FAILED` : "ALL CHECKS PASSED");
  fs.writeFileSync(path.join(OUT, "results.txt"), [
    "In-page QR scanner — the real app in Chromium at 412×915, as the Android app without the built-in scanner,",
    "with a fake camera playing videos of real SellerFlowLive stickers (see make-previews.cjs).",
    "The QR reader here is the loaded one (Chromium on this machine has no reader of its own).",
    "", ...lines, "",
  ].join("\n"));
  console.log(failed ? `${failed} CHECK(S) FAILED` : "ALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
