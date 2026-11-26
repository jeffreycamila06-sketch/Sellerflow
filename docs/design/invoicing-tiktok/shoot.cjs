// The REAL app (preview mode: src/dev/fakeSupabase.ts, made-up seller and buyers) → Settings → Invoicing.
// ?ivc=40,12 = a running 2-day session with 40 TikTok buyers, 12 already saved as Sent.
// Pictures on iPhone 390, Android 360 and a laptop 1280, light and dark: the TikTok tab mid-way, a row's
// sheet, the Format sheet, the Instagram "Soon" tab. Plus a measured check on 360 / 390 / 430 / 1280 px in all
// 8 languages: nothing runs sideways, the header is one line, every button is at least 44 px tall, the big
// button and every row stay inside the screen.
// Follow-ups (2026-11-26): the session picker open, a past session picked, and the "Copy failed" state —
// pictures on the three sizes (light + dark) and a measured check at 360 px in all 8 languages.
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

async function invoicing(b, { w, h, theme = "light", lang = "en", query = "ivc=40,12", failCopy = false }) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  // TikTok is never really opened from a picture run; with failCopy the phone refuses every copy
  await p.addInitScript((fail) => {
    document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("a[target=_blank]")) e.preventDefault(); });
    if (fail) {
      try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("refused")) } }); } catch { /* nothing */ }
      document.execCommand = () => false;
    }
  }, failCopy);
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
  // 3. the session picker, a past session, "Copy failed"
  const extra = (p) => p.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const el = (id) => document.querySelector(`[data-testid=${id}]`);
    const r = (id) => el(id)?.getBoundingClientRect();
    const inside = (b) => !!b && b.left >= 0 && b.right <= vw + 0.5;
    const items = [...document.querySelectorAll("[data-testid=ivc-session-item], [data-testid=ivc-session-current]")];
    const small = [...document.querySelectorAll("[data-testid=invoicing-screen] button, [data-testid=invoicing-screen] a")]
      .filter((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height < 43.5; }).map((x) => `${x.getAttribute("data-testid")}:${Math.round(x.getBoundingClientRect().height)}`);
    const cut = (x) => x.scrollWidth > x.clientWidth + 1;
    return {
      vw, sideways: document.documentElement.scrollWidth > vw + 1 || [...document.querySelectorAll("*")].some((e) => e.scrollLeft !== 0) || window.scrollX !== 0,
      btn: el("ivc-session-btn") ? `${Math.round(r("ivc-session-btn").height)}px "${el("ivc-session-label").textContent}"` : "", btnInside: inside(r("ivc-session-btn")), btnCut: el("ivc-session-btn") ? cut(el("ivc-session-label")) : false,
      btnBg: el("ivc-session-btn") ? getComputedStyle(el("ivc-session-btn")).backgroundColor : "",
      menu: !!el("ivc-session-menu"), menuInside: !el("ivc-session-menu") || inside(r("ivc-session-menu")),
      items: items.map((x) => x.textContent), itemMin: items.length ? Math.min(...items.map((x) => Math.round(x.getBoundingClientRect().height))) : 0, itemsInside: items.every((x) => inside(x.getBoundingClientRect())), itemsCut: items.some(cut),
      pastLine: el("ivc-past-line")?.textContent || "", pastInside: !el("ivc-past-line") || inside(r("ivc-past-line")),
      rows: document.querySelectorAll("[data-testid=ivc-row]").length,
      tags: [...document.querySelectorAll("[data-testid=ivc-row]")].reduce((m, x) => { const k = x.getAttribute("data-tag"); m[k] = (m[k] || 0) + 1; return m; }, {}),
      failTag: document.querySelector("[data-testid=ivc-row][data-tag=copy_failed] [data-testid=ivc-row-tag]")?.textContent || "",
      button: el("ivc-send-next")?.textContent || "", buttonH: el("ivc-send-next") ? Math.round(r("ivc-send-next").height) : 0, buttonInside: !el("ivc-send-next") || inside(r("ivc-send-next")),
      failBox: !!el("ivc-copy-fail-text"), failBoxInside: !el("ivc-copy-fail") || (inside(r("ivc-copy-fail")) && r("ivc-copy-fail").bottom <= document.documentElement.scrollHeight),
      failSelected: el("ivc-copy-fail-text") ? el("ivc-copy-fail-text").selectionEnd - el("ivc-copy-fail-text").selectionStart === el("ivc-copy-fail-text").value.length : false,
      progress: el("ivc-progress-text")?.textContent || "", small, vh,
    };
  });
  const amber = "rgb(254, 243, 199)";
  const walk = async ({ w, h, theme, lang, shot }) => {
    // a) the picker open
    const { p, errs } = await invoicing(b, { w, h, theme, lang });
    const before = await extra(p);
    await tap(p, "[data-testid=ivc-session-btn]");
    await p.waitForSelector("[data-testid=ivc-session-item]");
    await p.waitForTimeout(350);
    const open = await extra(p);
    if (shot) await p.screenshot({ path: path.join(OUT, `picker_${shot}.png`) });
    let ok = !open.sideways && open.btnInside && !open.btnCut && open.menuInside && open.items.length === 4 && open.itemMin >= 44 && open.itemsInside && open.small.length === 0 && before.btnBg !== amber && errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} picker ${shot || `${w}px ${lang}`}: button ${open.btn} · list inside=${open.menuInside} · ${open.items.length} lines, lowest ${open.itemMin}px, none cut=${!open.itemsCut} · sideways=${open.sideways}${open.small.length ? ` · small: ${open.small.join(", ")}` : ""}${errs.length ? ` · errors: ${errs.join(" | ")}` : ""}`);
    if (shot === "iphone390_light") out.push(`    ${open.items.join("  |  ")}`);
    // b) a past session (the 2-day one)
    await tap(p, "[data-testid=ivc-session-item][data-session=past-a]");
    await p.waitForSelector("[data-testid=ivc-past-line]");
    await p.waitForTimeout(450);
    const past = await extra(p);
    const pm = await measure(p);
    if (shot) await p.screenshot({ path: path.join(OUT, `past_${shot}.png`) });
    ok = !past.sideways && past.btnBg === amber && past.btnInside && !past.btnCut && past.pastInside && !!past.pastLine && past.rows === 14 && past.tags.sent === 5 && past.small.length === 0 && pm.rowsInside && !pm.tagCut && pm.nextInside && pm.nextHeight >= 44 && errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} past ${shot || `${w}px ${lang}`}: button ${past.btn} amber=${past.btnBg === amber} · line "${past.pastLine}" · ${past.rows} rows, tags ${JSON.stringify(past.tags)} · ${past.progress} · button "${past.button}" ${past.buttonH}px · sideways=${past.sideways}${past.small.length ? ` · small: ${past.small.join(", ")}` : ""}`);
    await p.close();
    // c) "Copy failed": the phone refuses the copy on Send next
    const f = await invoicing(b, { w, h, theme, lang, failCopy: true });
    await tap(f.p, "[data-testid=ivc-send-next]");
    await f.p.waitForSelector("[data-testid=ivc-row][data-tag=copy_failed]");
    await f.p.waitForTimeout(350);
    const fail = await extra(f.p);
    const fm = await measure(f.p);
    if (shot) {
      await f.p.screenshot({ path: path.join(OUT, `copyfailed_${shot}.png`) });
      await f.p.locator("[data-testid=ivc-row][data-tag=copy_failed]").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await f.p.waitForTimeout(250);
      await f.p.screenshot({ path: path.join(OUT, `copyfailed_row_${shot}.png`) });
    }
    ok = !fail.sideways && fail.tags.copy_failed === 1 && !fail.tags.sending && !!fail.failTag && fail.buttonInside && fail.buttonH >= 44 && fail.failBox && fail.failBoxInside && fail.failSelected && fail.small.length === 0 && !fm.tagCut && fm.rowsInside && fail.progress === before.progress && f.errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} copy failed ${shot || `${w}px ${lang}`}: tag "${fail.failTag}" on 1 row, nobody "Sending…" · button "${fail.button}" ${fail.buttonH}px inside=${fail.buttonInside} · message shown=${fail.failBox} selected=${fail.failSelected} · ${fail.progress} (as before the tap: ${fail.progress === before.progress}) · sideways=${fail.sideways}${fail.small.length ? ` · small: ${fail.small.join(", ")}` : ""}${f.errs.length ? ` · errors: ${f.errs.join(" | ")}` : ""}`);
    await f.p.close();
  };
  out.push("", "— session picker · a past session · Copy failed —");
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) await walk({ w, h, theme, lang: "en", shot: `${dev}_${theme}` });
  for (const w of [360, 430]) for (const lang of LANGS) if (!(w === 360 && lang === "en")) await walk({ w, h: 800, theme: "light", lang });
  out.push("", bad ? `${bad} BAD` : "all checks ok");
  fs.writeFileSync(path.join(__dirname, "measured.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
