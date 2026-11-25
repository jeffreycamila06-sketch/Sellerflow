// REAL-BROWSER CHECK of the scanner's "camera isn't available" limit (never shipped).
// Same set-up as make-previews.cjs: the REAL app (preview mode) in Chromium at 412×915, told it is the
// Android app WITHOUT the built-in scanner, with a fake camera. This browser has no QR reader of its
// own, so the scanner loads its own (a .wasm file) — the case the limit used to get wrong.
//
//   A. SLOW READER: the reader's file is held back 14 s while the camera shows a sticker.
//      Expected: no "camera isn't available" (not at 8 s, not later); the scanner stays open with the
//      live picture and the QR is read once a reader is there. The reader's file is asked for when the
//      scanner OPENS — before the camera has answered (the camera is held back 2.5 s here to see it).
//   B. NO FRAMES AT ALL: the camera opens but never gives one picture.
//      Expected: nothing before 8 s; after 8 s "The camera isn't available right now", camera off.
//
//   1) the camera videos:  OUT=<folder> npx vitest run --config previews/web-qr-scanner/harness/vitest.gen.config.ts
//   2) the app:            npx vite --config vite.preview.config.ts --port 5199
//   3) this:               node previews/web-qr-scanner/timer-check.cjs <folder> [port] [results file]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CAM = process.argv[2];
const PORT = process.argv[3] || "5199";
const RESULTS = process.argv[4] || path.join(__dirname, "timer-results.txt");
if (!CAM || !fs.existsSync(path.join(CAM, "one.y4m"))) { console.error("usage: node timer-check.cjs <folder with one.y4m> [port] [results file]"); process.exit(2); }
const BASE = `http://localhost:${PORT}`;
const VIEW = { width: 412, height: 915 };
const lines = [];
let failed = 0;
const say = (ok, text) => { if (!ok) failed++; const l = `${ok ? "ok  " : "FAIL"} ${text}`; lines.push(l); console.log(l); };
const note = (text) => { lines.push(`     ${text}`); console.log(`     ${text}`); };

async function phone(o = {}) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${path.join(CAM, "one.y4m")}`] });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((opt) => {
    window.Capacitor = { getPlatform: () => "android", Plugins: {} };
    try { delete window.BarcodeDetector; } catch { /* not there */ }   // this phone has no QR reader of its own
    window.__tracks = [];
    window.__t = {};
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      window.__t.camAsked = performance.now();
      if (opt.camDelay) await new Promise((r) => setTimeout(r, opt.camDelay));
      let s;
      if (opt.noFrames) {
        // a camera that opens but never gives a picture: a canvas stream that is never drawn
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 480;
        s = canvas.captureStream(0);
      } else s = await real(c);
      for (const t of s.getTracks()) window.__tracks.push(t);
      window.__t.camAnswered = performance.now();
      return s;
    };
  }, o);
  return { browser, page, errors };
}
const settle = (page, ms) => page.waitForTimeout(ms);
const state = (page) => page.evaluate(() => {
  const q = (id) => document.querySelector(`[data-testid=${id}]`);
  const v = q("wqs-video");
  return {
    open: !!q("wqs"),
    panel: q("wqs-panel") ? getComputedStyle(q("wqs-panel")).display !== "none" : false,
    panelText: q("wqs-panel") ? q("wqs-panel").textContent : "",
    hint: q("wqs-hint") ? q("wqs-hint").textContent : "",
    picture: v ? `${v.videoWidth}×${v.videoHeight}` : "-",
    tracks: window.__tracks.length,
    live: window.__tracks.filter((t) => t.readyState === "live").length,
    toast: [...document.querySelectorAll("body *")].some((n) => n.children.length === 0 && /camera isn.t available/i.test(n.textContent || "")),
  };
});
async function openParcelScan(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await settle(page, 900);
  await page.locator("button", { hasText: /^Settings$/ }).last().click();
  await settle(page, 400);
  await page.click("[data-testid=tile-parcelscan]");
  await settle(page, 900);
  await page.click("[data-testid=ps-manual]");
  await settle(page, 300);
}

(async () => {
  // ── A. the reader's file takes 14 s; the camera shows a sticker ────────────────────────────
  {
    const { browser, page, errors } = await phone({ camDelay: 2500 });
    const wasm = { asked: 0, served: 0 };
    let tap = 0;
    await page.route(/\.wasm(\?|$)/, async (route) => {
      wasm.asked = wasm.asked || Date.now();
      await new Promise((r) => setTimeout(r, 14000));
      wasm.served = Date.now();
      await route.continue().catch(() => undefined);
    });
    await openParcelScan(page);
    tap = Date.now();
    await page.click("[data-testid=ps-scan-qr]");
    await page.waitForSelector("[data-testid=wqs]", { timeout: 8000 });
    await page.waitForFunction(() => window.__t.camAnswered > 0, null, { timeout: 15000 });
    const camAnsweredAt = Date.now();
    say(wasm.asked > 0 && wasm.asked < camAnsweredAt, wasm.asked
      ? `the reader's file was asked for ${wasm.asked - tap} ms after the tap — the camera answered only ${camAnsweredAt - tap} ms after the tap (the reader loads from the moment the scanner opens)`
      : `the reader's file was NOT asked for before the camera answered (${camAnsweredAt - tap} ms after the tap)`);
    await page.waitForFunction(() => { const v = document.querySelector("[data-testid=wqs-video]"); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    const firstPicture = Date.now();
    // look every second until 11 s after the first camera picture (the old limit was 8 s after the camera opened)
    let bad = "";
    for (let i = 1; i <= 11; i++) {
      await settle(page, 1000);
      const s = await state(page);
      const read = (await page.locator("[data-testid=ps-bc-input], [data-testid=ps-notes]").first().inputValue()) !== "";
      if (read) { note(`a reader was there ${Date.now() - firstPicture} ms after the first camera picture → the QR was read`); break; }
      if (!s.open || s.panel || s.toast) { bad = `at ${i} s: open=${s.open} panel=${s.panel} "${s.panelText}" toast=${s.toast}`; break; }
      if (i === 9) say(s.open && !s.panel && !s.toast && s.live === 1 && s.picture !== "0×0", `9 s after the first camera picture, reader still loading: scanner open, picture ${s.picture}, hint "${s.hint}", camera on, NO "camera isn't available"`);
    }
    say(bad === "", `never a "camera isn't available" while the reader was loading ${bad}`);
    const gotRead = await page.waitForFunction(() => { const i = document.querySelector("[data-testid=ps-bc-input], [data-testid=ps-notes]"); return i && i.value !== ""; }, null, { timeout: bad ? 3000 : 40000 }).then(() => true, () => false);
    const v = await page.locator("[data-testid=ps-bc-input], [data-testid=ps-notes]").first().inputValue();
    say(gotRead && v === "jhun.belle", gotRead
      ? `then the QR was read: username "${v}", ${Date.now() - tap} ms after the tap (${wasm.served ? `the reader's file was served ${wasm.served - tap} ms after the tap` : "the reader's file was still held back — the smaller reader took over after 10 s"})`
      : "the QR was never read (the scanner had already given up)");
    await settle(page, 200);
    const end = await state(page);
    say(!end.open && end.live === 0 && end.tracks >= 1, `after the read: scanner gone, ${end.tracks} camera track(s), still on: ${end.live}`);
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }

  // ── B. the camera opens but never gives a picture ─────────────────────────────────────────
  {
    const { browser, page, errors } = await phone({ noFrames: true });
    await openParcelScan(page);
    await page.click("[data-testid=ps-scan-qr]");
    await page.waitForSelector("[data-testid=wqs]", { timeout: 8000 });
    await page.waitForFunction(() => window.__t.camAnswered > 0, null, { timeout: 8000 });
    const opened = Date.now();
    await settle(page, 6500);
    const mid = await state(page);
    say(mid.open && !mid.panel && !mid.toast && mid.picture === "0×0" && mid.live === 1, `6.5 s after the camera opened, no picture (${mid.picture}): still waiting — scanner open, no message yet`);
    await page.waitForFunction(() => {
      const p = document.querySelector("[data-testid=wqs-panel]");
      const shown = p && getComputedStyle(p).display !== "none";
      const toast = [...document.querySelectorAll("body *")].some((n) => n.children.length === 0 && /camera isn.t available/i.test(n.textContent || ""));
      return shown || toast || !document.querySelector("[data-testid=wqs]");
    }, null, { timeout: 6000 });
    const ms = Date.now() - opened;
    const end = await state(page);
    say(ms >= 7800 && ms <= 9500, `the camera message came ${ms} ms after the camera opened (limit 8 s)`);
    say((end.panel && /camera isn.t available/i.test(end.panelText)) || end.toast, `it says: "${end.panel ? end.panelText : "The camera isn't available right now (line on the screen under the scanner)"}"`);
    say(end.live === 0 && end.tracks >= 1, `the camera is off (${end.tracks} track(s), still on: ${end.live})`);
    if (end.open) {
      const photo = await page.$("[data-testid=wqs-photo]");
      say(!!photo, "the scanner stays with its own \"Take a photo instead\" button (8 s after the tap the phone no longer lets the page open the photo picker by itself)");
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null), page.click("[data-testid=wqs-photo]")]);
      say(!!chooser, "a tap on it opens today's photo picker");
    }
    say(errors.length === 0, `no page error (${errors.length})`);
    await browser.close();
  }

  lines.push("", failed ? `${failed} CHECK(S) FAILED` : "ALL CHECKS PASSED");
  fs.writeFileSync(RESULTS, lines.join("\n") + "\n");
  console.log(lines[lines.length - 1]);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
