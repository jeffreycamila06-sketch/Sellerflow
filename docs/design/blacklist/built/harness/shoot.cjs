// node docs/design/blacklist/built/harness/shoot.cjs   (page server: npx vite --config docs/design/blacklist/built/harness/vite.config.mjs --port 5334)
// The BUILT screens, clicked through like a seller would (the real components; made-up data):
// iPhone 390 / Android 360 / laptop 1280 × English / Filipino. Checks every picture: sideways scroll,
// text cut without "…", phone buttons smaller than 44 px, page errors, the Add button's colour.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "shots");
const LANGS = ["en", "fil"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const IMG = { name: "sticker.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) };
const reason = (p, r) => p.click(`[data-testid=bl-reason-${r}]`);
const SHOTS = [
  ["settings", "view=settings", async () => {}],
  ["settings_seen", "view=settings&seen=1", async () => {}],
  ["bl_pick", "view=bl", async () => {}],
  ["bl_ready", "view=bl", async (p) => { await reason(p, "return"); await p.fill("[data-testid=bl-type]", "@kikay_mommy23"); }],
  ["bl_reading", "view=bl&qr=wait", async (p) => { await reason(p, "notout"); await p.setInputFiles("[data-testid=bl-file]", IMG); }],
  ["bl_scanned", "view=bl&qr=link", async (p) => { await reason(p, "notout"); await p.setInputFiles("[data-testid=bl-file]", IMG); }],
  ["bl_added", "view=bl", async (p) => { await reason(p, "return"); await p.fill("[data-testid=bl-type]", "@kikay_mommy23"); await p.click("[data-testid=bl-add]"); }],
  ["bl_undone", "view=bl", async (p) => { await reason(p, "return"); await p.fill("[data-testid=bl-type]", "@kikay_mommy23"); await p.click("[data-testid=bl-add]"); await p.click("[data-testid=bl-undo]"); }],
  ["bl_already", "view=bl", async (p) => { await reason(p, "return"); await p.fill("[data-testid=bl-type]", "@Rhea.Ukay"); await p.click("[data-testid=bl-add]"); }],
  ["bl_facebook", "view=bl", async (p) => { await reason(p, "notout"); await p.click("[data-testid=bl-pf-fb]"); await p.fill("[data-testid=bl-type]", "Ana Reyes"); await p.click("[data-testid=bl-add]"); }],
  ["bl_space", "view=bl", async (p) => { await reason(p, "return"); await p.fill("[data-testid=bl-type]", "maria shop"); }],
  ["bl_noqr", "view=bl&qr=other", async (p) => { await reason(p, "return"); await p.setInputFiles("[data-testid=bl-file]", IMG); }],
  ["bl_search", "view=bl", async (p) => { await p.fill("[data-testid=bl-search]", "maria"); }],
  ["bl_remove", "view=bl", async (p) => { await p.click("[data-testid=bl-remove] >> nth=0"); }],
  ["bl_empty", "view=bl&empty=1", async () => {}],
  ["live", "view=live", async () => {}],
  ["livesheet", "view=live", async (p) => { await p.click("[data-testid=bl-name] >> nth=0"); }],
];
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  const lines = [];
  for (const [dev, w, h] of DEVICES) for (const lang of LANGS) for (const [name0, q, act] of SHOTS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`http://localhost:5334/docs/design/blacklist/built/harness/index.html?${q}&lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    await act(p);
    await p.waitForTimeout(400);
    const name = `${name0}_${dev}_${lang}`;
    const m = await p.evaluate((phone) => {
      const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const cut = [];
      for (const e of document.querySelectorAll("[data-testid], button, span, div, td")) {
        if (!e.childElementCount && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis") cut.push(`"${e.textContent.trim().slice(0, 30)}"`);
      }
      // a tile whose content is wider than the tile (the NEW badge problem of STEP 0)
      for (const t of document.querySelectorAll("[data-testid=tile-blacklist]")) {
        const r = t.getBoundingClientRect();
        for (const c of t.querySelectorAll("*")) { const cr = c.getBoundingClientRect(); if (c.dataset.testid !== "tile-blacklist-new" && (cr.right > r.right + 0.5 || cr.left < r.left - 0.5)) cut.push(`tile overflow "${c.textContent.trim().slice(0, 20)}"`); }
      }
      const small = phone ? [...document.querySelectorAll("[data-testid^=bl-], [data-testid=tile-blacklist]")].filter((e) => e.tagName === "BUTTON" || (e.tagName === "INPUT" && e.type !== "file")).filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => `${e.dataset.testid}:${Math.round(e.getBoundingClientRect().height)}px`) : [];
      // the live-row name's tap area must not cover any other button (1-Click / Type price / the row above)
      for (const nb of document.querySelectorAll("[data-testid=bl-name]")) {
        const a = nb.getBoundingClientRect();
        for (const o of document.querySelectorAll("button")) {
          if (o === nb) continue;
          const r = o.getBoundingClientRect();
          if (r.width && r.height && a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top) cut.push(`name tap area covers "${o.textContent.trim().slice(0, 16)}"`);
        }
      }
      const ell = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).map((e) => `"${e.textContent.trim().slice(0, 24)}…"`);
      const add = document.querySelector("[data-testid=bl-add]");
      const addBg = add ? getComputedStyle(add).backgroundColor : "";
      return { sideways, cut: [...new Set(cut)], small, ell: [...new Set(ell)], addBg };
    }, w < 900);
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    const problems = m.sideways + m.cut.length + m.small.length + errs.length;
    bad += problems;
    const line = `${name}: sideways ${m.sideways}px · cut ${m.cut.join(", ") || 0} · small buttons ${m.small.join(", ") || 0} · shortened with … ${m.ell.join(", ") || 0}${m.addBg ? ` · Add colour ${m.addBg}` : ""}${errs.length ? " · ERRORS " + errs.join(" | ") : ""}`;
    lines.push(line); console.log(line);
    await p.close();
  }
  const verdict = bad ? `PROBLEMS: ${bad}` : "no sideways scroll, no cut text, every phone button ≥ 44 px, no page error";
  console.log(verdict);
  require("fs").writeFileSync(path.join(__dirname, "..", "measured.txt"), lines.join("\n") + "\n" + verdict + "\n");
  await b.close();
})();
