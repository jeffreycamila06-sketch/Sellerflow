// MOCKUP generator for docs/plans/buyer-qr-id-plan.md (Hakbang 1 — no app code is changed).
// It opens the REAL Parcel Scan screens (7-11 + FamilyMart) on the in-memory preview database
// (vite.preview.config.ts), types sample values into the REAL fields, and then draws the PROPOSED
// banner / chip / chooser on top as plain DOM (data-mock). Nothing here exists in the app yet.
//   1) npx vite --config vite.preview.config.ts --port 5199
//   2) node docs/design/buyer-qr-id/make-mockups.cjs
const { chromium } = require("playwright");
const path = require("path");
const OUT = __dirname;
const DEVICES = [
  { id: "iphone390", w: 390, h: 844 },
  { id: "android360", w: 360, h: 800 },
  { id: "android430", w: 430, h: 932 },
  { id: "laptop1280", w: 1280, h: 800 },
];
const C = {
  ok: { bd: "var(--ok)", bg: "color-mix(in srgb, var(--ok) 12%, var(--surface))", fg: "var(--ok)" },
  warn: { bd: "var(--warn)", bg: "var(--warn-soft)", fg: "var(--warn)" },
  info: { bd: "var(--accent)", bg: "var(--accent-soft)", fg: "var(--accent-text, var(--accent))" },
  bad: { bd: "var(--danger)", bg: "var(--danger-soft)", fg: "var(--danger)" },
};
// state → what the encoder sees right after Scan QR (plan v4: three kinds of result —
// GREEN = known by the QR code · YELLOW = filled but "please check", with ONE reason · NOTE = a short message)
const STATES = (fm) => {
  const store = fm ? "022131" : "266402", store2 = fm ? "018274" : "133712";
  return [
    { id: "1-before-scan" },
    { id: "2-green-known", tone: "ok", icon: "✓", title: "Buyer found · @maria_shops",
      body: "Last used Nov 3. Check the details, then type the amount.",
      fill: { name: "王小美", phone: "0912345678", store, contact: "maria_shops" }, chip: "@maria_shops", focusAmount: true },
    { id: "3-yellow-two-stores", tone: "warn", icon: "!", title: "This buyer used 2 stores — please check",
      body: "The newest is selected. Tap another to use it.", chip: "@maria_shops",
      fill: { name: "王小美", phone: "0912345678", store, contact: "maria_shops" },
      choices: [["王小美", "0912345678", store, "Nov 3", true], ["王小美", "0912345678", store2, "Oct 12", false]] },
    { id: "4-yellow-username", tone: "warn", icon: "!", title: "Found by username @maria_shops — please check",
      body: "This sticker has no buyer code. These are the details saved in Customers for this username (last used Oct 28).",
      fill: { name: "王小美", phone: "0912345678", store, contact: "maria_shops" } },
    { id: "5-yellow-username-changed", tone: "warn", icon: "!", title: "The sticker shows a new username — please check",
      body: "Saved contact: @maria_shops · on the sticker: @maria_live.", chip: "@maria_live", actions: ["Use @maria_live"],
      fill: { name: "王小美", phone: "0912345678", store, contact: "maria_shops" } },
    { id: "6-note-no-details", note: "Filled @newbuyer_tw from QR — type the name, phone and store once.",
      fill: { contact: "newbuyer_tw" }, chip: "@newbuyer_tw" },
  ];
};

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

async function applyState(p, fm, st) {
  const k = fm ? "fms" : "ps";
  const f = st.fill || {};
  if (f.name) await p.fill(`[data-testid="${k}-name"]`, f.name);
  if (f.phone) await p.fill(`[data-testid="${k}-phone"]`, f.phone);
  if (f.store) await p.fill(`[data-testid="${k}-store"]`, f.store);
  if (f.contact) await p.locator(`[data-testid="${k}-bc-field"] input:not([type="checkbox"])`).first().fill(f.contact);
  if (st.note) {
    await p.evaluate(({ k, st }) => {
      const cardEl = document.querySelector(`[data-testid="${k}-confirm"]`);
      const head = cardEl.children[0];
      const line = document.createElement("div");
      line.setAttribute("data-mock", "note");
      line.style.cssText = "margin:0 0 10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--text-dim);line-height:1.35";
      line.innerHTML = `<span>${st.note}</span>` + (st.chip ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);background:var(--surface);font-size:10.5px;font-weight:700;color:var(--text)">▣ QR: ${st.chip} <span style="color:var(--text-dim);font-weight:800">✕</span></span>` : "");
      head.insertAdjacentElement("afterend", line);
      const tag = document.createElement("div");
      tag.setAttribute("data-mock", "tag");
      tag.textContent = "MOCKUP · not built yet";
      tag.style.cssText = "position:fixed;right:8px;bottom:6px;z-index:99999;padding:2px 7px;border-radius:6px;background:#111;color:#fff;font:700 10px/1.4 system-ui;opacity:.85;pointer-events:none";
      document.body.appendChild(tag);
    }, { k, st });
  }
  if (st.title) {
    await p.evaluate(({ k, st, c }) => {
      const cardEl = document.querySelector(`[data-testid="${k}-confirm"]`);
      const head = cardEl.children[0];
      const box = document.createElement("div");
      box.setAttribute("data-mock", "banner");
      box.style.cssText = `margin:0 0 10px;padding:9px 11px;border-radius:11px;border:1px solid ${c.bd};background:${c.bg};display:flex;gap:9px;align-items:flex-start;`;
      const chip = st.chip ? `<span style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);background:var(--surface);font-size:10.5px;font-weight:700;color:var(--text)">▣ QR: ${st.chip} <span style="color:var(--text-dim);font-weight:800">✕</span></span>` : "";
      const rows = (st.choices || []).map((r) => `<button type="button" style="display:flex;width:100%;align-items:center;gap:8px;margin-top:6px;padding:8px 10px;border-radius:9px;border:${r[4] ? "2px solid var(--accent)" : "1px solid var(--border-strong)"};background:var(--surface);color:var(--text);font-family:var(--font-ui);font-size:12px;font-weight:700;text-align:left;min-height:44px"><span style="flex-shrink:0;width:14px;height:14px;border-radius:999px;border:2px solid ${r[4] ? "var(--accent)" : "var(--border-strong)"};background:${r[4] ? "var(--accent)" : "transparent"};box-shadow:inset 0 0 0 2px var(--surface)"></span><span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r[0]} · ${r[1]} · ${r[2]}</span><span style="flex-shrink:0;font-size:10.5px;font-weight:600;color:var(--text-dim)">${r[3]}</span></button>`).join("");
      const acts = (st.actions || []).map((a) => `<span style="display:inline-flex;align-items:center;margin:6px 0 0 6px;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);background:transparent;font-size:10.5px;font-weight:700;color:var(--accent);border-color:var(--accent);background:var(--surface)">${a}</span>`).join("");
      const none = "";
      box.innerHTML = `<div style="flex-shrink:0;width:20px;height:20px;border-radius:999px;background:${c.fg};color:var(--surface);font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;margin-top:1px">${st.icon}</div>` +
        `<div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:800;color:var(--text);overflow-wrap:anywhere">${st.title}</div>` +
        `<div style="font-size:11.5px;font-weight:600;color:var(--text-dim);margin-top:2px;line-height:1.35">${st.body}</div>${chip}${acts}${rows}${none}</div>`;
      head.insertAdjacentElement("afterend", box);
      const tag = document.createElement("div");
      tag.setAttribute("data-mock", "tag");
      tag.textContent = "MOCKUP · not built yet";
      tag.style.cssText = "position:fixed;right:8px;bottom:6px;z-index:99999;padding:2px 7px;border-radius:6px;background:#111;color:#fff;font:700 10px/1.4 system-ui;opacity:.85;pointer-events:none";
      document.body.appendChild(tag);
    }, { k, st, c: C[st.tone] });
  }
  if (st.focusAmount) await p.evaluate((k) => document.querySelector(`[data-testid="${k}-amount"]`).focus({ preventScroll: true }), k);
  else await p.evaluate(() => document.activeElement && document.activeElement.blur());
  // put the top of the manual-entry card just under the sticky bars; return where the card ends
  const bottom = await p.evaluate((k) => {
    const cardEl = document.querySelector(`[data-testid="${k}-confirm"]`);
    let sc = cardEl.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const bar = document.querySelector(`[data-testid="${k}-topbar"]`);
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const delta = cardEl.getBoundingClientRect().top - barBottom - 10;
    if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
    return Math.ceil(cardEl.getBoundingClientRect().bottom);
  }, k);
  await p.waitForTimeout(250);
  return bottom;
}

(async () => {
  const only = process.argv[2];
  const b = await chromium.launch();
  for (const d of DEVICES) for (const fm of [false, true]) for (const st of STATES(fm)) {
    const name = `${fm ? "fm" : "711"}_${st.id}_${d.id}.jpg`;
    if (only && !name.includes(only)) continue;
    // pass 1: how tall must the picture be to show the whole card (a real phone scrolls instead)
    let p = await b.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1 });
    await openManual(p, fm);
    const bottom = await applyState(p, fm, st);
    await p.close();
    const h = Math.max(d.h, bottom + (d.w < 900 ? 96 : 24));
    p = await b.newPage({ viewport: { width: d.w, height: h }, deviceScaleFactor: 2 });
    await openManual(p, fm);
    await applyState(p, fm, st);
    await p.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 78 });
    await p.close();
    console.log("ok", name);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
