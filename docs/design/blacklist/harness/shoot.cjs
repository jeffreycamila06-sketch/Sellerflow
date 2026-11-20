// node docs/design/blacklist/harness/shoot.cjs   (page server: npx vite --config docs/design/blacklist/harness/vite.config.mjs --port 5333)
// Every view/state × iPhone 390 / Android 360 / laptop 1280 × English / Filipino: a full-page picture
// in shots/, plus checks: sideways scroll, text cut without "…", buttons smaller than 44 px (phones).
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "shots");
const LANGS = ["en", "fil"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const SHOTS = [["settings", ""], ["bl", "pick"], ["bl", "ready"], ["bl", "reading"], ["bl", "added"], ["bl", "already"], ["bl", "noqr"], ["bl", "search"], ["bl", "remove"], ["bl", "empty"], ["live", ""], ["livesheet", ""]];
const URL = (v, s, l) => `http://localhost:5333/docs/design/blacklist/harness/index.html?view=${v}&state=${s}&lang=${l}`;
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [dev, w, h] of DEVICES) for (const lang of LANGS) for (const [v, s] of SHOTS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(URL(v, s, lang), { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    const name = `${v}${s ? "_" + s : ""}_${dev}_${lang}`;
    const m = await p.evaluate((phone) => {
      const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const cut = [];
      for (const e of document.querySelectorAll("[data-testid], button, span, div")) {
        if (!e.childElementCount && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis") cut.push(`"${e.textContent.trim().slice(0, 30)}"`);
      }
      const small = phone ? [...document.querySelectorAll("[data-testid^=bl-], [data-testid=tile-blacklist]")].filter((e) => e.tagName === "BUTTON" || e.tagName === "INPUT").filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.dataset.testid}:${Math.round(e.getBoundingClientRect().height)}px`) : [];
      const ell = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).map((e) => `"${e.textContent.trim().slice(0, 24)}…"`);
      return { sideways, cut: [...new Set(cut)], small, ell: [...new Set(ell)] };
    }, w < 900);
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    const problems = m.sideways + m.cut.length + m.small.length + errs.length;
    bad += problems;
    console.log(`${name}: sideways ${m.sideways}px · cut ${m.cut.join(", ") || 0} · small buttons ${m.small.join(", ") || 0} · shortened with … ${m.ell.join(", ") || 0}${errs.length ? " · ERRORS " + errs.join(" | ") : ""}`);
    await p.close();
  }
  console.log(bad ? `PROBLEMS: ${bad}` : "no sideways scroll, no cut text, every phone button ≥ 44 px");
  await b.close();
})();
