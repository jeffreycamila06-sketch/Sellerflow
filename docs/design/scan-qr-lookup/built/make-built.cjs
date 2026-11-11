// REAL screens of the built "Scan QR → fill from Customers" (Hakbang 3, Jeff 2026-11-12: no list, no box).
// Nothing is drawn on top: the preview database (src/dev/fakeSupabase.ts) has the switch ON and a few
// Customers records; a REAL QR picture is given to the REAL Scan QR input and the app does the rest.
//   1) npx vite --config vite.preview.config.ts --port 5199
//   2) node docs/design/scan-qr-lookup/built/make-built.cjs [name-filter]
const { chromium } = require("playwright");
const path = require("path");
const OUT = __dirname;
const DEVICES = [
  { id: "iphone390", w: 390, h: 844 },
  { id: "android360", w: 360, h: 800 },
  { id: "android430", w: 430, h: 932 },
  { id: "laptop1280", w: 1280, h: 800 },
];
// @annc_tw has 3 records in the preview Customers (the newest is saved as "@annc_tw (U)") → that one is filled.
const STATES = [
  { id: "1-filled", qr: "https://tiktok.com/@annc_tw" },
  { id: "2-no-match", qr: "https://tiktok.com/@newbuyer_tw" },
];

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
async function qrPng(p, text) {
  return p.evaluate((t) => new Promise((res) => {
    const s2 = document.createElement("script"); s2.src = "/node_modules/qrcode-generator/qrcode.js";
    s2.onload = () => { const q = window.qrcode(0, "M"); q.addData(t); q.make(); const n = q.getModuleCount(), sc = 8, qz = 4, W = (n + 2 * qz) * sc;
      const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, W); x.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect((cc + qz) * sc, (r + qz) * sc, sc, sc);
      res(c.toDataURL("image/png").split(",")[1]); };
    document.head.appendChild(s2);
  }), text);
}
async function applyState(p, fm, st) {
  const k = fm ? "fms" : "ps";
  const png = await qrPng(p, st.qr);
  await p.setInputFiles(`[data-testid="${k}-qr-file"]`, { name: "sticker-qr.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p.waitForSelector(`[data-testid="${k}-toast"]`, { timeout: 8000 });
  await p.waitForTimeout(700); // the lookup answer
  const info = await p.evaluate((k) => {
    const cardEl = document.querySelector(`[data-testid="${k}-confirm"]`);
    const top = document.querySelector(`[data-testid="${k}-toast"]`) || cardEl;
    let sc = cardEl.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const bar = document.querySelector(`[data-testid="${k}-topbar"]`);
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const delta = top.getBoundingClientRect().top - barBottom - 10;
    if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
    const v = (t) => document.querySelector(`[data-testid="${k}-${t}"]`).value;
    return {
      bottom: Math.ceil(cardEl.getBoundingClientRect().bottom),
      newUi: document.querySelectorAll('[data-testid*="-ql"]').length, // must be 0: nothing new is ever shown
      name: v("name"), phone: v("phone"), store: v("store"), focus: document.activeElement && document.activeElement.getAttribute("data-testid"),
      pageScrollX: document.documentElement.scrollWidth > window.innerWidth,
      topbarH: bar ? Math.round(bar.getBoundingClientRect().height) : 0, cardH: Math.round(cardEl.getBoundingClientRect().height),
    };
  }, k);
  await p.waitForTimeout(250);
  return info;
}

(async () => {
  const only = process.argv[2];
  const b = await chromium.launch();
  for (const d of DEVICES) for (const fm of [false, true]) for (const st of STATES) {
    const name = `${fm ? "fm" : "711"}_${st.id}_${d.id}.jpg`;
    if (only && !name.includes(only)) continue;
    let p = await b.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1 });
    await openManual(p, fm);
    const a = await applyState(p, fm, st);
    await p.close();
    const h = Math.max(d.h, a.bottom + (d.w < 900 ? 96 : 24));
    p = await b.newPage({ viewport: { width: d.w, height: h }, deviceScaleFactor: 2 });
    await openManual(p, fm);
    const info = await applyState(p, fm, st);
    await p.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 78 });
    await p.close();
    console.log("ok", name, JSON.stringify(info));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
