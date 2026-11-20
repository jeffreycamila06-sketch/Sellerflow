// node docs/design/fb-post-sales-public/harness/shoot-readonly.cjs   (fix round 1, 2026-11-20)
// The REAL screens (harness on port 5332) for a Plus seller whose plan EXPIRED and who has post orders:
// the view-only Posts side (the line, Print new off), My posts (no Sell / Edit / End now) and the
// waiting line (post buyer: Give off + its line; live buyer: Give on) — iPhone 390 / Android 360 /
// laptop 1280. Every language is measured; pictures are saved for English and Traditional Chinese.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "shots");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const SAVE = new Set(["en", "zh-TW"]);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const URL = (lang) => `http://localhost:5332/docs/design/fb-post-sales-public/harness/index.html?view=readonly&lang=${lang}`;
async function measure(p, sel) {
  return p.evaluate((sel) => {
    const cut = [...document.querySelectorAll(sel)].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.getAttribute("data-testid") || e.tagName}:"${e.textContent.trim().slice(0, 40)}"`);
    return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, cut };
  }, sel);
}
async function clip(p, file, w, topSel, bottomSel, pad = 14) {
  const box = await p.evaluate(([a, b, pad]) => {
    const t = document.querySelector(a).getBoundingClientRect().top + window.scrollY - pad;
    const els = [...document.querySelectorAll(b)];
    const bot = els[els.length - 1].getBoundingClientRect().bottom + window.scrollY + pad;
    return { top: Math.max(0, t), height: bot - Math.max(0, t) };
  }, [topSel, bottomSel, pad]);
  await p.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x: 0, y: box.top, width: w, height: box.height } });
}
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [dev, w, h] of DEVICES) for (const lang of LANGS) {
    const save = SAVE.has(lang), tag = `${dev}_${lang}`;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(URL(lang), { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    const access = await p.getAttribute("[data-access]", "data-access");
    // ① the waiting line on the Live side
    await p.waitForSelector("[data-testid=waitlist]");
    const wlm = await measure(p, "[data-testid=waitlist-post-off], [data-testid^=waitlist-give-], [data-testid=waitlist-post-label]");
    const wl = await p.evaluate(() => ({ line: !!document.querySelector("[data-testid=waitlist-post-off]"), post: [1, 2].map((i) => document.querySelector(`[data-testid=waitlist-give-${i}]`).disabled), live: document.querySelector("[data-testid=waitlist-give-3]").disabled }));
    if (save) await clip(p, `readonly_waitlist_${tag}.png`, w, "[data-testid=ord-live-posts]", "[data-testid=waitlist]");
    // ② the Posts side
    await p.click("[data-testid=ord-seg-posts]");
    await p.waitForSelector("[data-testid=posts-buyer-card]");
    await p.waitForTimeout(400);
    const m = await measure(p, "[data-testid=ord-seg-posts], [data-testid=posts-print-new], [data-testid=posts-my-btn], [data-testid=posts-readonly]");
    const pn = await p.evaluate(() => ({ line: (document.querySelector("[data-testid=posts-readonly]") || {}).textContent || "", off: document.querySelector("[data-testid=posts-print-new]").disabled, sell: !!document.querySelector("[data-testid=posts-sell-btn]"), cards: document.querySelectorAll("[data-testid=posts-buyer-card]").length }));
    if (save) await clip(p, `readonly_${tag}.png`, w, "[data-testid=ord-live-posts]", "[data-testid=posts-buyer-card]");
    // ③ My posts
    await p.click("[data-testid=posts-my-btn]");
    await p.waitForSelector("[data-testid=my-post-card]");
    await p.click("[data-testid=my-post-toggle]");
    await p.waitForTimeout(300);
    const mm = await measure(p, "[data-testid=posts-readonly], [data-testid=my-post-card]");
    const my = await p.evaluate(() => ({ sell: !!document.querySelector("[data-testid=my-posts-sell]"), edit: document.querySelectorAll("[data-testid=my-post-edit]").length, end: !!document.querySelector("[data-testid=my-post-end]"), items: document.querySelectorAll("[data-testid=my-post-item]").length, cards: document.querySelectorAll("[data-testid=my-post-card]").length }));
    if (save) await clip(p, `readonly_my_${tag}.png`, w, "[data-testid=my-posts]", "[data-testid=my-post-card]");
    const wrong = (access !== "readonly") + !wl.line + !wl.post[0] + !wl.post[1] + wl.live + !pn.line + !pn.off + pn.sell + (pn.cards < 1) + my.sell + my.edit + my.end + (my.items < 1) + (my.cards < 3);
    console.log(`${tag}: access=${access} · waitlist line ${wl.line} post Give off ${wl.post.join("/")} live Give on ${!wl.live} · Posts line ✓ Print new off ${pn.off} Sell shown ${pn.sell} cards ${pn.cards} · My posts: ${my.cards} posts, ${my.items} items, Sell ${my.sell} Edit ${my.edit} End now ${my.end} · sideways ${Math.max(wlm.sideways, m.sideways, mm.sideways)}px cut ${[...wlm.cut, ...m.cut, ...mm.cut].join(", ") || 0}`);
    bad += wrong + wlm.sideways + m.sideways + mm.sideways + wlm.cut.length + m.cut.length + mm.cut.length;
    await p.close();
  }
  console.log(bad ? `PROBLEMS: ${bad}` : "view-only right everywhere; no sideways scroll, no cut text");
  await b.close();
})();
