// node docs/design/fb-post-sales-public/harness/shoot.cjs
// The REAL screens (harness on port 5332): a Plus seller's Posts side, a Free seller's "Posts 🔒" tab +
// the popup it opens, and the "Ends" day picker (7 days, then 14 days with + turned off) — iPhone 390 /
// Android 360 / laptop 1280. Every language is measured (sideways scroll, any cut text); pictures are
// saved for English and Traditional Chinese.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "shots");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const SAVE = new Set(["en", "zh-TW"]);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const URL = (view, lang) => `http://localhost:5332/docs/design/fb-post-sales-public/harness/index.html?view=${view}&lang=${lang}`;

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
    const save = SAVE.has(lang);
    const tag = `${dev}_${lang}`;
    // ① Plus seller — the Posts side
    let p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(URL("plus", lang), { waitUntil: "networkidle" });
    await p.waitForTimeout(700); // the screen's entrance animation
    const accessPlus = await p.getAttribute("[data-access]", "data-access");
    await p.click("[data-testid=ord-seg-posts]");
    await p.waitForSelector("[data-testid=posts-buyer-card]");
    await p.waitForTimeout(400);
    let m = await measure(p, "[data-testid=ord-seg-posts], [data-testid=posts-print-new], [data-testid=posts-my-btn]");
    if (save) await clip(p, `plus_${tag}.png`, w, "[data-testid=ord-live-posts]", "[data-testid=posts-buyer-card]");
    console.log(`plus  ${tag}: access=${accessPlus} sideways ${m.sideways}px cut ${m.cut.length ? m.cut.join(", ") : 0}`);
    bad += (accessPlus !== "full") + m.sideways + m.cut.length;
    await p.close();
    // ② Free seller — Posts 🔒 and the popup
    p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(URL("free", lang), { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    const accessFree = await p.getAttribute("[data-access]", "data-access");
    await p.waitForSelector("[data-testid=ord-posts-lock]");
    m = await measure(p, "[data-testid=ord-seg-posts], [data-testid=ord-seg-live]");
    if (save) await p.screenshot({ path: path.join(OUT, `free_${tag}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(h, 420) } });
    await p.click("[data-testid=ord-seg-posts]");
    await p.waitForSelector("h3");
    await p.waitForTimeout(400);
    const pop = await p.evaluate(() => ({ title: document.querySelector("h3").textContent, posts: !!document.querySelector("[data-testid=posts-body]") }));
    if (save) await p.screenshot({ path: path.join(OUT, `free_popup_${tag}.png`) });
    console.log(`free  ${tag}: access=${accessFree} sideways ${m.sideways}px cut ${m.cut.length ? m.cut.join(", ") : 0} · popup "${pop.title}" · Posts opened: ${pop.posts}`);
    bad += (accessFree !== "locked") + m.sideways + m.cut.length + (pop.posts ? 1 : 0);
    await p.close();
    // ③ the Ends picker
    p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(URL("ends", lang), { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    await p.click("[data-testid=ord-seg-posts]");
    await p.click("[data-testid=posts-sell-btn]");
    await p.click("[data-testid=sell-post-row]");
    await p.fill("[data-testid=sell-item-name]", "Red dress");
    await p.fill("[data-testid=sell-item-code]", "A");
    await p.fill("[data-testid=sell-item-price]", "350");
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    const sel = "[data-testid=sell-ends], [data-testid=sell-days], [data-testid=sell-ends-date], [data-testid=sell-ends-max], #sell-ends-label";
    const m7 = await measure(p, sel);
    const r7 = await p.evaluate(() => [document.querySelector("[data-testid=sell-days]").textContent, document.querySelector("[data-testid=sell-ends-date]").textContent]);
    if (save) await clip(p, `ends7_${tag}.png`, w, "[data-testid=sell-item-row]", "[data-testid=sell-start]");
    for (let i = 0; i < 7; i++) await p.click("[data-testid=sell-days-more]");
    const r14 = await p.evaluate(() => [document.querySelector("[data-testid=sell-days]").textContent, document.querySelector("[data-testid=sell-ends-date]").textContent, document.querySelector("[data-testid=sell-days-more]").disabled]);
    const m14 = await measure(p, sel);
    if (save) await clip(p, `ends14_${tag}.png`, w, "[data-testid=sell-item-row]", "[data-testid=sell-start]");
    const btn = await p.evaluate(() => { const r = document.querySelector("[data-testid=sell-days-more]").getBoundingClientRect(); return `${r.width}x${r.height}`; });
    console.log(`ends  ${tag}: "${r7[0]}" ${r7[1]} → "${r14[0]}" ${r14[1]} (+ off: ${r14[2]}) · buttons ${btn} · sideways ${Math.max(m7.sideways, m14.sideways)}px cut ${[...m7.cut, ...m14.cut].join(", ") || 0}`);
    bad += m7.sideways + m14.sideways + m7.cut.length + m14.cut.length + (r14[2] ? 0 : 1);
    await p.close();
  }
  console.log(bad ? `PROBLEMS: ${bad}` : "no sideways scroll, no cut text, access right in every case");
  await b.close();
})();
