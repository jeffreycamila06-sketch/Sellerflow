// The REAL app (preview mode, made-up seller and buyers) → Settings → Invoicing, TikTok tab:
// the rows with "· N items" and "✎ View", a long username, and the row sheet with "I sent it by hand".
// Pictures on iPhone 390, Android 360 and a laptop 1280, light + dark, plus measured checks at
// 360 / 390 / 430 / 1280 in all 8 languages: nothing wider than the screen, total + View on one line each,
// the View tap area ≥ 44 px, the long username cut with "…", the count = the sheet's lines.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/invoicing-view/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

async function open(b, { w, h, theme = "light", lang = "en", refuseCopy = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  ctx.on("page", (pg) => { if (pg !== p) pg.close().catch(() => {}); });   // the TikTok link's new tab
  await p.addInitScript(([th, lg, refuse]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ }
    window.open = () => null;
    if (refuse) {
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) } }); } catch { /* nothing */ }
      document.execCommand = () => false;
    } else {
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() } }); } catch { /* nothing */ }
    }
  }, [theme, lang, refuseCopy]);
  await p.goto(`http://localhost:${port}/?ivc=40,12&ivclong=1`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  // links open nothing (the TikTok profile) — the click handler still runs
  await p.evaluate(() => document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[target=_blank]"); if (a) e.preventDefault(); }, true));
  return { p, errs, ctx };
}
async function toInvoicing(p) {
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^(Live|直播|ไลฟ์|Лайв)$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();
    }, i);
    await p.waitForTimeout(400);
  }
  await p.waitForSelector("[data-testid=tile-invoicing]");
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-row]");
  await p.waitForTimeout(500);
}
const measure = (p) => p.evaluate(() => {
  const vw = window.innerWidth;
  const out = { vw, pageWide: document.documentElement.scrollWidth > vw, problems: [] };
  for (const r of [...document.querySelectorAll("[data-testid=ivc-row]")].slice(0, 14)) {
    const n = r.getAttribute("data-buyer");
    const rr = r.getBoundingClientRect();
    const total = r.querySelector("[data-testid=ivc-row-total]");
    const view = r.querySelector("[data-testid=ivc-row-view]");
    const items = r.querySelector("[data-testid=ivc-row-items]");
    const handle = r.querySelector("[data-testid=ivc-row-handle]");
    const tr = total.getBoundingClientRect(), vr = view.getBoundingClientRect();
    const lh = (el) => parseFloat(getComputedStyle(el).lineHeight) || 16;
    if (rr.right > vw + 0.5 || vr.right > rr.right + 0.5 || tr.right > rr.right + 0.5) out.problems.push(`#${n} past the row edge`);
    if (tr.height > lh(total) * 1.5) out.problems.push(`#${n} total wraps`);
    if (vr.height > 34) out.problems.push(`#${n} View wraps (${vr.height})`);
    if (items.getBoundingClientRect().height > lh(items) * 1.5) out.problems.push(`#${n} item count wraps`);
    if (handle.scrollWidth > handle.clientWidth + 1 && getComputedStyle(handle).textOverflow !== "ellipsis") out.problems.push(`#${n} handle cut without …`);
    const after = getComputedStyle(view, "::after");
    if (parseFloat(after.height) < 44) out.problems.push(`#${n} View tap area ${after.height}`);
    if (vr.top < tr.bottom - 0.5) out.problems.push(`#${n} View not under the total`);
  }
  const long = [...document.querySelectorAll("[data-testid=ivc-row-handle]")].find((h) => h.textContent.includes("very.long"));
  // cut with "…" when it does not fit (phones); shown whole when it does (laptop)
  out.longCut = long ? (long.scrollWidth > long.clientWidth ? "cut" : "whole") : null;
  return out;
});
(async () => {
  const b = await chromium.launch();
  const lines = [];
  // pictures
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) {
    const { p, errs, ctx } = await open(b, { w, h, theme });
    await toInvoicing(p);
    await p.evaluate(() => document.querySelector("[data-testid=ivc-list]").scrollIntoView({ block: "start" }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `list_${dev}_${theme}.png`) });
    // Send next once → that buyer is "Sending…"; open their sheet with View
    await tap(p, "[data-testid=ivc-send-next]");
    await p.waitForTimeout(500);
    const sendingRow = await p.evaluate(() => document.querySelector("[data-testid=ivc-row][data-tag=sending]")?.getAttribute("data-buyer"));
    await tap(p, `[data-testid=ivc-row][data-buyer="${sendingRow}"] [data-testid=ivc-row-view]`);
    await p.waitForSelector("[data-testid=tts-by-hand]");
    await p.evaluate(() => document.querySelector("[data-testid=tts-by-hand]").scrollIntoView({ block: "end" }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `sheet_sending_${dev}_${theme}.png`) });
    lines.push(`${dev} ${theme}: sending row #${sendingRow}, by-hand shown; errors ${errs.length}`);
    await ctx.close();
  }
  // copy refused → "Copy failed" row + sheet
  for (const theme of ["light", "dark"]) {
    const { p, errs, ctx } = await open(b, { w: 390, h: 844, theme, refuseCopy: true });
    await toInvoicing(p);
    await tap(p, "[data-testid=ivc-send-next]");
    await p.waitForTimeout(500);
    const cf = await p.evaluate(() => document.querySelector("[data-testid=ivc-row][data-tag=copy_failed]")?.getAttribute("data-buyer"));
    await p.evaluate((n) => document.querySelector(`[data-testid=ivc-row][data-buyer="${n}"]`).scrollIntoView({ block: "center" }), cf);
    await p.screenshot({ path: path.join(OUT, `list_copyfailed_iphone390_${theme}.png`) });
    await tap(p, `[data-testid=ivc-row][data-buyer="${cf}"]`);
    await p.waitForSelector("[data-testid=tts-by-hand]");
    await p.evaluate(() => document.querySelector("[data-testid=tts-by-hand]").scrollIntoView({ block: "end" }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `sheet_copyfailed_iphone390_${theme}.png`) });
    await tap(p, "[data-testid=tts-by-hand]");
    await p.waitForTimeout(500);
    const after = await p.evaluate((n) => ({ sheet: !!document.querySelector("[data-testid=tts-sheet]"), tag: document.querySelector(`[data-testid=ivc-row][data-buyer="${n}"]`).getAttribute("data-tag") }), cf);
    lines.push(`copy refused ${theme}: row #${cf} copy_failed → by hand → sheet open ${after.sheet}, tag ${after.tag}; errors ${errs.length}`);
    await ctx.close();
  }
  // measured, all languages
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs, ctx } = await open(b, { w, h: 900, lang });
    await toInvoicing(p);
    const m = await measure(p);
    // the count = the sheet's lines, for the first 6 rows
    const counts = await p.evaluate(async () => {
      const bad = [];
      for (const r of [...document.querySelectorAll("[data-testid=ivc-row]")].slice(0, 6)) {
        const n = Number(r.querySelector("[data-testid=ivc-row-items]").textContent.replace(/\D/g, ""));
        r.querySelector("[data-testid=ivc-row-view]").click();
        await new Promise((ok) => setTimeout(ok, 120));
        const lines = document.querySelectorAll("[data-testid=tts-line]").length;
        if (lines !== n) bad.push(`#${r.getAttribute("data-buyer")} count ${n} sheet ${lines}`);
        document.querySelector("[data-testid=tts-close]").click();
        await new Promise((ok) => setTimeout(ok, 80));
      }
      return bad;
    });
    if (w === 360 && lang !== "en") await p.screenshot({ path: path.join(OUT, `lang_360_${lang}.png`) });
    const ok = !m.pageWide && m.problems.length === 0 && counts.length === 0 && (m.longCut === "cut" || (m.longCut === "whole" && w >= 900)) && errs.length === 0;
    lines.push(`${w} ${lang}: ${ok ? "ok" : "PROBLEM"} wide=${m.pageWide} longCut=${m.longCut} ${[...m.problems, ...counts].join("; ")} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
