// The username changed BY HAND after a fill — REAL screens and REAL values from the browser (preview database, switch ON).
// Steps on each screen: manual entry → Scan QR of @annc_tw (has records → filled) → then, by hand:
//   A) the username retyped another way (@ANNC_TW)            → nothing is erased
//   B) one detail changed by the seller, then another username → the changed one stays, the untouched ones go
//   C) (fresh entry) another username typed                    → all three filled details go     [pictures: before / after]
//   D) (fresh entry) the "no handle" tick                      → all three filled details go
//   1) npx vite --config vite.preview.config.ts --port 5199
//   2) node docs/design/scan-qr-lookup/built/make-handchange.cjs
const { chromium } = require("playwright");
const path = require("path");
const OUT = __dirname;
const WIDTHS = [{ id: "android360", w: 360, h: 800 }, { id: "iphone390", w: 390, h: 844 }, { id: "android430", w: 430, h: 932 }, { id: "laptop1280", w: 1280, h: 800 }];

async function openManual(p, fm) {
  await p.goto("http://localhost:5199/", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.locator("button", { hasText: /^Settings$/ }).last().click();
  await p.waitForTimeout(400);
  await p.click(fm ? '[data-testid="tile-parcelscan-fm-open"]' : '[data-testid="tile-parcelscan"]');
  await p.waitForTimeout(900);
  await p.click(fm ? '[data-testid="fms-manual"]' : '[data-testid="ps-manual"]');
  await p.waitForTimeout(400);
}
async function scan(p, k, text) {
  const png = await p.evaluate((t) => new Promise((res) => {
    const s2 = document.createElement("script"); s2.src = "/node_modules/qrcode-generator/qrcode.js";
    s2.onload = () => { const q = window.qrcode(0, "M"); q.addData(t); q.make(); const n = q.getModuleCount(), sc = 8, qz = 4, W = (n + 2 * qz) * sc;
      const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, W); x.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect((cc + qz) * sc, (r + qz) * sc, sc, sc);
      res(c.toDataURL("image/png").split(",")[1]); };
    document.head.appendChild(s2);
  }), text);
  await p.setInputFiles(`[data-testid="${k}-qr-file"]`, { name: "sticker-qr.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p.waitForSelector(`[data-testid="${k}-toast"]`, { timeout: 8000 });
  await p.waitForTimeout(800); // the lookup answer
}
const read = (p, k, user) => p.evaluate(({ k, user }) => {
  const v = (sel) => document.querySelector(sel).value;
  return { username: v(user), name: v(`[data-testid="${k}-name"]`), phone: v(`[data-testid="${k}-phone"]`), store: v(`[data-testid="${k}-store"]`),
    newUi: document.querySelectorAll('[data-testid*="-ql"]').length, scrollX: document.documentElement.scrollWidth > window.innerWidth };
}, { k, user });
async function shot(p, k, file) {
  await p.evaluate((k) => {
    const cardEl = document.querySelector(`[data-testid="${k}-confirm"]`);
    let sc = cardEl.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const bar = document.querySelector(`[data-testid="${k}-topbar"]`);
    const delta = cardEl.getBoundingClientRect().top - (bar ? bar.getBoundingClientRect().bottom : 0) - 10;
    if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
  }, k);
  await p.waitForTimeout(3200); // the scan's message has gone
  await p.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 72 });
}
const fmt = (o) => `username="${o.username}" name="${o.name}" phone="${o.phone}" store="${o.store}"`;

(async () => {
  const b = await chromium.launch();
  let bad = 0;
  const check = (label, got, want) => {
    const ok = got.name === want.name && got.phone === want.phone && got.store === want.store && got.newUi === 0 && !got.scrollX;
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "BAD"} ${label}: ${fmt(got)}${got.newUi ? " NEW-UI" : ""}${got.scrollX ? " SIDE-SCROLL" : ""}`);
  };
  for (const fm of [false, true]) for (const d of WIDTHS) {
    const k = fm ? "fms" : "ps", tag = `${fm ? "fm " : "711"} ${String(d.w).padStart(4)}px`;
    const p = await b.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.w >= 1000 ? 1 : 2 });
    await openManual(p, fm);
    const user = (await p.locator(`[data-testid="${k}-bc-input"]`).count()) > 0 ? `[data-testid="${k}-bc-input"]` : `[data-testid="${fm ? "fms-username" : "ps-notes"}"]`;
    const tick = (await p.locator(`[data-testid="${k}-bc-none"]`).count()) > 0 ? `[data-testid="${k}-bc-none"]` : `[data-testid="${k}-no-handle"]`;
    // filled
    await scan(p, k, "https://tiktok.com/@annc_tw");
    const filled = await read(p, k, user);
    const F = { name: filled.name, phone: filled.phone, store: filled.store };
    if (!F.name || !F.phone || !F.store) { bad++; console.log(`BAD ${tag} the scan did not fill: ${fmt(filled)}`); await p.close(); continue; }
    console.log(`--  ${tag} after Scan QR: ${fmt(filled)}`);
    // A) the same username another way
    await p.fill(user, "@ANNC_TW");
    check(`${tag} A) retyped "@ANNC_TW" → nothing erased`, await read(p, k, user), F);
    // B) one detail changed, then another username
    await p.fill(`[data-testid="${k}-phone"]`, "0999888777");
    await p.fill(user, "another_buyer");
    check(`${tag} B) phone changed by the seller, then "another_buyer" → phone stays, name + store go`, await read(p, k, user), { name: "", phone: "0999888777", store: "" });
    // C) fresh entry: another username typed
    await p.fill(`[data-testid="${k}-phone"]`, "");
    await p.fill(user, "");
    await scan(p, k, "https://tiktok.com/@annc_tw");
    check(`${tag} C) scanned again on the emptied entry → filled again`, await read(p, k, user), F);
    if (d.id === "iphone390") await shot(p, k, `${fm ? "fm" : "711"}_4-hand-change-before_${d.id}.jpg`);
    await p.fill(user, "another_buyer");
    check(`${tag} C) "another_buyer" typed by hand → all three go`, await read(p, k, user), { name: "", phone: "", store: "" });
    if (d.id === "iphone390") await shot(p, k, `${fm ? "fm" : "711"}_4-hand-change-after_${d.id}.jpg`);
    // D) fresh entry: the "no handle" tick
    await p.fill(user, "");
    await scan(p, k, "https://tiktok.com/@annc_tw");
    check(`${tag} D) scanned again → filled again`, await read(p, k, user), F);
    await p.click(tick);
    check(`${tag} D) "no handle" ticked → all three go`, await read(p, k, user), { name: "", phone: "", store: "" });
    await p.close();
  }
  console.log(bad === 0 ? "ALL AS EXPECTED" : `NOT AS EXPECTED: ${bad}`);
  await b.close();
  if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
