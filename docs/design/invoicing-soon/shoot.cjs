// The REAL app (preview mode: src/dev/fakeSupabase.ts, made-up seller) → Settings tab → the Invoicing card.
// Pictures in light and dark, the "coming soon" note on a phone, and a measured check on every size and in
// all 8 languages: the card is inside the screen, nothing runs sideways, "Soon" is whole and on one line.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/invoicing-soon/shoot.cjs [port]
// ?fac=1 = a FREE seller (no Receipt format screen) · ?admin=1 = an admin (Website card shown).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];

async function settings(b, { w, h, theme = "light", lang = "en", query = "fac=1" }) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, lg]) => { try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ } }, [theme, lang]);
  await p.goto(`http://localhost:${port}/?${query}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  // the Settings tab is the last item of the app's menu (bottom bar on a phone, side bar on a laptop; its word changes with the language)
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^(Live|直播|ไลฟ์|Лайв)$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();   // an admin has "Admin" after Settings: walk back
    }, i);
    await p.waitForTimeout(400);
  }
  await p.waitForSelector("[data-testid=tile-invoicing]");
  await p.waitForTimeout(700);
  return { p, errs };
}
const measure = (p) => p.evaluate(() => {
  const vw = window.innerWidth;
  const card = document.querySelector("[data-testid=tile-invoicing]");
  const r = card.getBoundingClientRect();
  const badge = card.querySelector("[data-testid=invoicing-soon]").getBoundingClientRect();
  const chip = card.querySelector("[data-testid=invoicing-chip]").getBoundingClientRect();
  const [title, sub] = [...card.children[1].children];
  const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  const cs = getComputedStyle(card);
  const web = document.querySelector("[data-testid=tile-website], [data-testid=tile-website-soon]");
  const before = card.previousElementSibling;
  return {
    vw, left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height),
    inside: r.left >= 13 && r.right <= vw - 13,                     // the tab's 14 px sides
    sideways: document.documentElement.scrollWidth > vw + 1,
    badgeInside: badge.left >= r.left && badge.right <= r.right - 8, badgeOneLine: badge.height < 26,
    chip: `${Math.round(chip.width)}x${Math.round(chip.height)}`,
    titleLines: lines(title), subLines: lines(sub),
    textClipped: card.children[1].scrollWidth > card.children[1].clientWidth + 1,
    // the border as written; this test browser draws whole pixels on its 1x screen, a phone (2x / 3x) draws the 1.5
    border: `${card.style.borderWidth || card.style.border.split(" ")[0]} ${cs.borderTopColor}`, borderOk: card.style.border.startsWith("1.5px solid"), chipBg: getComputedStyle(card.querySelector("[data-testid=invoicing-chip]")).backgroundColor,
    after: web ? (before === web ? "the Website card" : "NOT the Website card") : "Invite friends (no Website card)",
    oldTile: !!document.querySelector("[data-testid=tile-receipt-format]"),
  };
});

(async () => {
  const b = await chromium.launch();
  const out = [];
  let bad = 0;
  const note = (name, m, errs) => {
    const ok = m.inside && m.borderOk && !m.sideways && m.badgeInside && m.badgeOneLine && !m.textClipped && !m.oldTile && !m.after.startsWith("NOT") && errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} ${name}: card ${m.left}–${m.right}px of ${m.vw}px, ${m.height}px tall · title ${m.titleLines} line · sub-line ${m.subLines} line(s) · ` +
      `Soon whole=${m.badgeInside} one line=${m.badgeOneLine} · sideways=${m.sideways} · text cut=${m.textClipped} · border ${m.border} · chip ${m.chip} ${m.chipBg} · after ${m.after} · old tile=${m.oldTile}${errs.length ? ` · page errors=${errs.length}` : ""}`);
  };

  // 1. pictures: iPhone 390, Android 360, laptop 1280 — light and dark (a Free seller)
  for (const [dev, w, h] of [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]]) for (const theme of ["light", "dark"]) {
    const { p, errs } = await settings(b, { w, h, theme });
    await p.screenshot({ path: path.join(OUT, `settings_${dev}_${theme}.png`) });
    note(`settings_${dev}_${theme}.png`, await measure(p), errs);
    await p.close();
  }
  // 2. the "coming soon" note on a phone (tap the card), light and dark
  for (const theme of ["light", "dark"]) {
    const { p, errs } = await settings(b, { w: 390, h: 844, theme });
    await p.click("[data-testid=tile-invoicing]");
    await p.waitForSelector("[data-testid=app-toast]");
    await p.waitForTimeout(450);
    const t = await p.evaluate(() => {
      const el = document.querySelector("[data-testid=app-toast]"); const r = el.getBoundingClientRect();
      return { text: el.textContent, inside: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, lines: Math.round(r.height / 17.55), stillSettings: !!document.querySelector("[data-testid=tile-invoicing]") };
    });
    await p.screenshot({ path: path.join(OUT, `note_iphone390_${theme}.png`) });
    const ok = t.inside && t.stillSettings && errs.length === 0;
    if (!ok) bad += 1;
    out.push(`${ok ? "ok " : "BAD"} note_iphone390_${theme}.png: "${t.text}" · inside the screen=${t.inside} · still on the Settings tab=${t.stillSettings}`);
    await p.close();
  }
  // 3. with the Website card / its "Soon" teaser: the Invoicing card comes right after it
  for (const [name, query] of [["with_website", "fac=1&web=1"], ["with_website_soon", "fac=1&web=soon"]]) {
    const { p, errs } = await settings(b, { w: 390, h: 844, query });
    await p.screenshot({ path: path.join(OUT, `settings_iphone390_${name}.png`) });
    const m = await measure(p);
    if (m.after !== "the Website card") m.after = `NOT the Website card (${m.after})`;
    note(`settings_iphone390_${name}.png`, m, errs);
    await p.close();
  }
  // 4. measured only: 320 / 360 / 390 / 430 px in all 8 languages (the smallest gets a picture per language)
  for (const w of [320, 360, 390, 430]) for (const lang of LANGS) {
    const { p, errs } = await settings(b, { w, h: 780, lang });
    if (w === 320) await p.locator("[data-testid=tile-invoicing]").screenshot({ path: path.join(OUT, `card_320_${lang}.png`) });
    note(`${w}px ${lang}`, await measure(p), errs);
    await p.close();
  }
  out.push("", bad ? `${bad} BAD` : `all ${out.length} checks ok`);
  fs.writeFileSync(path.join(__dirname, "measured.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
