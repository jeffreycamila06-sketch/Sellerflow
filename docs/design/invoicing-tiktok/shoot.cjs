// The REAL app (preview mode: src/dev/fakeSupabase.ts, made-up seller and buyers) → Settings → Invoicing.
// ?ivc=40,12 = a running 2-day session with 40 TikTok buyers, 12 already saved as Sent.
// Pictures on iPhone 390, Android 360 and a laptop 1280, light and dark: the TikTok tab mid-way, a row's
// sheet, the Format sheet, the Instagram "Soon" tab. Plus a measured check on 360 / 390 / 430 / 1280 px in all
// 8 languages: nothing runs sideways, the header is one line, every button is at least 44 px tall, the big
// button and every row stay inside the screen.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/invoicing-tiktok/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];

async function invoicing(b, { w, h, theme = "light", lang = "en", query = "ivc=40,12" }) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, lg]) => { try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ } }, [theme, lang]);
  await p.goto(`http://localhost:${port}/?${query}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  // the Settings tab is the last item of the app's menu (its word changes with the language)
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
  await p.waitForTimeout(700);
  return { p, errs };
}
// A tap as the phone does it. (Playwright's own click first scrolls the target into view, and that moves the
// app's frame sideways in the dark theme — a hidden container a finger cannot move. Every check below also
// makes sure that frame is not moved.)
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const measure = (p) => p.evaluate(() => {
  const vw = window.innerWidth;
  const box = (sel) => document.querySelector(`[data-testid=${sel}]`)?.getBoundingClientRect();
  const inside = (r) => !!r && r.left >= 0 && r.right <= vw + 0.5;
  const head = document.querySelector("[data-testid=back-row]").getBoundingClientRect();
  const rows = [...document.querySelectorAll("[data-testid=ivc-row]")];
  const tags = {};
  for (const r of rows) tags[r.getAttribute("data-tag")] = (tags[r.getAttribute("data-tag")] || 0) + 1;
  const small = [...document.querySelectorAll("[data-testid=invoicing-screen] button, [data-testid=invoicing-screen] a")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 43.5; })
    .map((el) => `${el.getAttribute("data-testid")}:${Math.round(el.getBoundingClientRect().height)}`);
  const next = box("ivc-send-next");
  return {
    vw, sideways: document.documentElement.scrollWidth > vw + 1 || [...document.querySelectorAll("*")].some((e) => e.scrollLeft !== 0) || window.scrollX !== 0,
    headerHeight: Math.round(head.height),
    formatBtn: `${Math.round(box("ivc-format-btn").width)}x${Math.round(box("ivc-format-btn").height)}`, formatInside: inside(box("ivc-format-btn")),
    tabs: [...document.querySelectorAll("[role=tab]")].map((t) => t.scrollWidth <= t.clientWidth + 1).every(Boolean),
    nextInside: inside(next), nextHeight: next ? Math.round(next.height) : 0,
    rows: rows.length, rowsInside: rows.every((r) => inside(r.getBoundingClientRect())),
    rowMin: Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))),
    tagCut: rows.some((r) => { const t = r.querySelector("[data-testid=ivc-row-tag]").getBoundingClientRect(); const rr = r.getBoundingClientRect(); return t.right > rr.right; }),
    tags, small,
    summary: document.querySelector("[data-testid=ivc-summary-line]").textContent,
    progress: document.querySelector("[data-testid=ivc-progress-text]").textContent,
    button: document.querySelector("[data-testid=ivc-send-next]")?.textContent || "",
  };
});

(async () => {
  const b = await chromium.launch();
  const out = [];
  let bad = 0;
  const note = (name, m, errs) => {
    const ok = !m.sideways && m.headerHeight <= 50 && m.formatInside && m.tabs && m.nextInside && m.nextHeight >= 44 && m.rowsInside && m.rowMin >= 44 && !m.tagCut && m.small.length === 0 && errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} ${name}: ${m.vw}px · sideways=${m.sideways} · header ${m.headerHeight}px (one line) · Format ${m.formatBtn} inside=${m.formatInside} · tabs whole=${m.tabs} · Send next inside=${m.nextInside} ${m.nextHeight}px · ${m.rows} rows inside=${m.rowsInside}, smallest ${m.rowMin}px · tag cut=${m.tagCut}` +
      `${m.small.length ? ` · small buttons: ${m.small.join(", ")}` : ""}${errs.length ? ` · page errors: ${errs.join(" | ")}` : ""}`);
  };

  // 1. the four screens × 3 sizes × light / dark
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) {
    const { p, errs } = await invoicing(b, { w, h, theme });
    const m = await measure(p);
    await p.screenshot({ path: path.join(OUT, `tiktok_${dev}_${theme}.png`) });
    note(`tiktok_${dev}_${theme}.png`, m, errs);
    if (theme === "light" && dev === "iphone390") out.push(`    ${m.summary} · ${m.progress} · button "${m.button}" · tags ${JSON.stringify(m.tags)}`);
    // further down: Sent, Next, Not sent, Can't message and New item next to each other
    await p.locator("[data-testid=ivc-row][data-buyer='11']").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `tiktok_tags_${dev}_${theme}.png`) });
    // a row's sheet (the buyer who is Next)
    await tap(p, "[data-testid=ivc-row][data-tag=next]");
    await p.waitForSelector("[data-testid=tts-sheet]");
    await p.waitForTimeout(450);
    const sheet = await p.evaluate(() => {
      const s = document.querySelector("[data-testid=tts-sheet]").getBoundingClientRect();
      const btns = ["tts-copy-open", "tts-copy-only", "tts-skip"].map((id) => document.querySelector(`[data-testid=${id}]`).getBoundingClientRect());
      return { inside: s.left >= 0 && s.right <= window.innerWidth + 0.5 && s.bottom <= window.innerHeight + 0.5, buttonsSeen: btns.every((r) => r.bottom <= window.innerHeight + 0.5 && r.height >= 40), fee: document.querySelector("[data-testid=tts-shipping]").value };
    });
    await p.screenshot({ path: path.join(OUT, `sheet_${dev}_${theme}.png`) });
    if (!(sheet.inside && sheet.buttonsSeen && sheet.fee === "38")) bad += 1;
    out.push(`${sheet.inside && sheet.buttonsSeen && sheet.fee === "38" ? "ok " : "BAD"} sheet_${dev}_${theme}.png: sheet inside the screen=${sheet.inside} · Send / Copy / Can't message all seen above the bottom=${sheet.buttonsSeen} · shipping fee starts at ${sheet.fee}`);
    await tap(p, "[data-testid=tts-close]");
    // the Format sheet
    await p.evaluate(() => window.scrollTo(0, 0));
    await tap(p, "[data-testid=ivc-format-btn]");
    await p.waitForSelector("[data-testid=ivc-format-sheet]");
    await p.waitForTimeout(450);
    const fmt = await p.evaluate(() => {
      const s = document.querySelector("[data-testid=ivc-format-sheet]").getBoundingClientRect();
      const save = document.querySelector("[data-testid=ivc-format-save]").getBoundingClientRect();
      return { inside: s.left >= 0 && s.right <= window.innerWidth + 0.5, saveSeen: save.bottom <= window.innerHeight + 0.5 && save.height >= 44, type: document.querySelector("[data-testid=ivc-format-type]").textContent };
    });
    await p.screenshot({ path: path.join(OUT, `format_${dev}_${theme}.png`) });
    if (!(fmt.inside && fmt.saveSeen)) bad += 1;
    out.push(`${fmt.inside && fmt.saveSeen ? "ok " : "BAD"} format_${dev}_${theme}.png: sheet inside=${fmt.inside} · Save seen=${fmt.saveSeen} · "${fmt.type}"`);
    await tap(p, "[data-testid=ivc-format-close]");
    // Instagram: Soon
    await tap(p, "[data-testid=ivc-tab-instagram]");
    await p.waitForSelector("[data-testid=ivc-soon-instagram]");
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(OUT, `instagram_${dev}_${theme}.png`) });
    const soon = await p.evaluate(() => ({ text: document.querySelector("[data-testid=ivc-soon-instagram]").textContent, sideways: document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll("*")].some((e) => e.scrollLeft !== 0), send: !!document.querySelector("[data-testid=ivc-send-next]") }));
    if (soon.sideways || soon.send) bad += 1;
    out.push(`${!soon.sideways && !soon.send ? "ok " : "BAD"} instagram_${dev}_${theme}.png: "${soon.text}" · no Send button=${!soon.send}`);
    await p.close();
  }
  // 2. measured only: 360 / 390 / 430 / 1280 px in all 8 languages
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs } = await invoicing(b, { w, h: 800, lang });
    note(`${w}px ${lang}`, await measure(p), errs);
    if (w === 360 && lang !== "en") await p.screenshot({ path: path.join(OUT, `lang_360_${lang}.png`) });
    await p.close();
  }
  out.push("", bad ? `${bad} BAD` : "all checks ok");
  fs.writeFileSync(path.join(__dirname, "measured.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
