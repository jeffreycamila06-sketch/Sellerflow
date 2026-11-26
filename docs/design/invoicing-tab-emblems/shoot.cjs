// The REAL app (preview mode, made-up seller and buyers) → Settings → Invoicing: the tab bar with the Live
// picker's emblems. Pictures on iPhone 390, Android 360 and a laptop 1280, light + dark, plus measured
// checks: the 4 tabs fit at 360 / 390 / 430 / 1280 in all 8 languages, every tab is 44 px+, the emblem is
// inside its tab, the selected tab's outline, the animation each emblem really runs (name + duration),
// and that "reduce motion" and the app's motion switch stop all of them.
// It also compares the LIVE PICKER between main and this branch: the same pixels and the same animations.
//   servers:  branch  npx vite --config vite.preview.config.ts --port 5199
//             main    (a checkout of origin/main) … --port 5198
//   node docs/design/invoicing-tab-emblems/shoot.cjs [branch port] [main port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const port = process.argv[2] || "5199";
const mainPort = process.argv[3] || "5198";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

async function open(b, { w, h, theme = "light", lang = "en", reduce = false, motionOff = false, base = port, query = "ivc=40,12" }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: reduce ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, lg, off]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); if (off) localStorage.setItem("sfl_rd_motion", "0"); } catch { /* nothing */ }
  }, [theme, lang, motionOff]);
  await p.goto(`http://localhost:${base}/?${query}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
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
  await p.waitForSelector("[data-testid=ivc-tabs]");
  await p.waitForTimeout(600);
}
const measure = (p) => p.evaluate(() => {
  const vw = window.innerWidth;
  const bar = document.querySelector("[data-testid=ivc-tabs]");
  const tabs = [...bar.querySelectorAll("[role=tab]")];
  const rows = tabs.map((t) => {
    const r = t.getBoundingClientRect();
    const name = t.querySelector("[data-testid^=ivc-tab-name-]");
    const emb = t.querySelector("[data-testid^=ivc-tab-emblem-]").getBoundingClientRect();
    const shape = t.querySelector(".sfl-lpk-shape").getBoundingClientRect();
    const anim = getComputedStyle(t.querySelector(".sfl-lpk-emb"));
    const cs = getComputedStyle(t);
    return {
      id: t.getAttribute("data-testid").replace("ivc-tab-", ""), on: t.getAttribute("aria-selected") === "true",
      w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.right <= vw + 0.5,
      nameCut: name.scrollWidth > name.clientWidth + 1, name: name.textContent,
      embInside: emb.top >= r.top && emb.bottom <= r.bottom && emb.left >= r.left && emb.right <= r.right,
      shape: `${Math.round(shape.width)}x${Math.round(shape.height)}`,
      emblemAboveName: emb.bottom <= name.getBoundingClientRect().top + 0.5,
      anim: anim.animationName, dur: anim.animationDuration, iter: anim.animationIterationCount,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`, bg: cs.backgroundColor,
    };
  });
  return {
    vw, rows, barInside: bar.getBoundingClientRect().left >= 0 && bar.getBoundingClientRect().right <= vw + 0.5,
    sideways: document.documentElement.scrollWidth > vw + 1 || [...document.querySelectorAll("*")].some((e) => e.scrollLeft !== 0) || window.scrollX !== 0,
    live: !!bar.querySelector(".sfl-lpk-tag") || /LIVE/.test(bar.textContent),
    surface: getComputedStyle(document.querySelector("[data-redesign]")).getPropertyValue("--surface").trim(),
    text: getComputedStyle(document.querySelector("[data-testid=ivc-tab-name-tiktok]")).color,
  };
});
const FRAMES = { tiktok: "sflLpkBeat", facebook: "sflLpkBob", instagram: "sflLpkSway", shopee: "sflLpkFlip" };
const FULL = { tiktok: "1.7s", facebook: "2.8s", instagram: "3.2s", shopee: "3.8s" };
const CALM = { tiktok: "4.25s", facebook: "7s", instagram: "8s", shopee: "9.5s" };
const BRAND = { facebook: "rgb(24, 119, 242)", instagram: "rgb(193, 53, 132)", shopee: "rgb(238, 77, 45)" };

(async () => {
  const b = await chromium.launch();
  const out = [];
  let bad = 0;
  const line = (ok, text) => { if (!ok) bad += 1; out.push(`${ok ? "ok " : "BAD"} ${text}`); };
  const layoutOk = (m) => !m.sideways && m.barInside && !m.live && m.rows.length === 4
    && m.rows.every((r) => r.h >= 44 && r.inside && !r.nameCut && r.embInside && r.emblemAboveName);
  const motionOk = (m) => m.rows.every((r) => r.anim === FRAMES[r.id] && r.dur === (r.on ? FULL[r.id] : CALM[r.id]) && r.iter === "infinite");

  // 1. pictures: 3 sizes × light / dark, TikTok selected; + each other tab selected
  out.push("— the tab bar: pictures —");
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) {
    const { p, errs, ctx } = await open(b, { w, h, theme });
    await toInvoicing(p);
    const m = await measure(p);
    await p.screenshot({ path: path.join(OUT, `tabs_${dev}_${theme}.png`) });
    const sel = m.rows.find((r) => r.on);
    const selOk = sel.id === "tiktok" && sel.border === `2px ${m.text}` && m.rows.filter((r) => !r.on).every((r) => r.border.startsWith("2px rgba(0, 0, 0, 0)"));
    line(layoutOk(m) && motionOk(m) && selOk && errs.length === 0,
      `tabs_${dev}_${theme}.png: ${m.vw}px · tabs ${m.rows.map((r) => `${r.name} ${r.w}x${r.h}`).join(" · ")} · emblems ${m.rows.map((r) => r.shape).join(" ")} inside their tabs, above the names=${m.rows.every((r) => r.embInside && r.emblemAboveName)} · no name cut=${m.rows.every((r) => !r.nameCut)} · no LIVE tag=${!m.live} · selected ${sel.id}: outline ${sel.border}, background ${sel.bg} · sideways=${m.sideways}${errs.length ? ` · errors: ${errs.join(" | ")}` : ""}`);
    if (dev === "iphone390") {
      out.push(`    motion (${theme}): ${m.rows.map((r) => `${r.id} ${r.anim} ${r.dur}${r.on ? " (selected)" : ""}`).join(" · ")}`);
      for (const id of ["facebook", "instagram", "shopee"]) {
        await tap(p, `[data-testid=ivc-tab-${id}]`);
        await p.waitForTimeout(350);
        const m2 = await measure(p);
        const s2 = m2.rows.find((r) => r.on);
        await p.screenshot({ path: path.join(OUT, `tabs_${id}_${dev}_${theme}.png`), clip: { x: 0, y: 0, width: w, height: 330 } });
        line(layoutOk(m2) && motionOk(m2) && s2.id === id && s2.border === `2px ${BRAND[id]}` && m2.rows.filter((r) => r.on).length === 1,
          `tabs_${id}_${dev}_${theme}.png: selected ${s2.id} · outline ${s2.border} · background ${s2.bg} · its emblem ${s2.anim} ${s2.dur}, the others ${m2.rows.filter((r) => !r.on).map((r) => r.dur).join(" / ")}`);
      }
    }
    await ctx.close();
  }

  // 2. measured: 360 / 390 / 430 / 1280 in all 8 languages
  out.push("", "— 4 tabs fit, every language —");
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs, ctx } = await open(b, { w, h: 800, lang });
    await toInvoicing(p);
    const m = await measure(p);
    line(layoutOk(m) && errs.length === 0, `${w}px ${lang}: tabs ${m.rows.map((r) => `${r.w}x${r.h}`).join(" ")} · names whole=${m.rows.every((r) => !r.nameCut)} · inside=${m.barInside} · sideways=${m.sideways}`);
    if (w === 360 && lang !== "en") await p.screenshot({ path: path.join(OUT, `lang_360_${lang}.png`), clip: { x: 0, y: 0, width: 360, height: 330 } });
    await ctx.close();
  }

  // 3. motion stops: "reduce motion" on the phone, and the app's motion switch
  out.push("", "— motion stops —");
  for (const [what, opts] of [["reduce motion (phone setting)", { reduce: true }], ["the app's motion switch off", { motionOff: true }]]) {
    const { p, ctx } = await open(b, { w: 390, h: 844, ...opts });
    await toInvoicing(p);
    const m = await measure(p);
    const names = m.rows.map((r) => r.anim);
    line(names.every((n) => n === "none") && layoutOk(m), `${what}: animations ${names.join(" / ")} · the tabs look the same (4 tabs, emblems in place)=${layoutOk(m)}`);
    await ctx.close();
  }

  // 4. the Live picker: main vs this branch — the same pixels (motion stopped so the frames match) and the same animations
  out.push("", "— the Live picker: main vs this branch —");
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const pickerAnims = (p) => p.evaluate(() => [...document.querySelectorAll("[data-testid^=lpk-tile-]")].map((t) => {
    const e = getComputedStyle(t.querySelector(".sfl-lpk-emb")); const n = getComputedStyle(t.querySelector(".sfl-lpk-name")); const s = t.querySelector(".sfl-lpk-shape").getBoundingClientRect();
    return `${t.getAttribute("data-testid").slice(9)} ${e.animationName} ${e.animationDuration} · name ${n.animationName} · ${Math.round(s.width * 10) / 10}x${Math.round(s.height * 10) / 10}`;
  }));
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) {
    const shots = {}; const anims = {};
    for (const [who, base] of [["main", mainPort], ["branch", port]]) {
      const still = await open(b, { w, h, theme, reduce: true, base, query: "" });
      await still.p.waitForSelector("[data-testid=lpk-picker]");
      await still.p.waitForTimeout(500);
      shots[who] = await still.p.screenshot();
      await still.ctx.close();
      const moving = await open(b, { w, h, theme, base, query: "" });
      await moving.p.waitForSelector("[data-testid=lpk-picker]");
      anims[who] = (await pickerAnims(moving.p)).join(" | ");
      await moving.ctx.close();
    }
    if (dev === "iphone390") fs.writeFileSync(path.join(OUT, `livepicker_${theme}_branch.png`), shots.branch);
    line(sha(shots.main) === sha(shots.branch) && anims.main === anims.branch,
      `Live picker ${dev} ${theme}: picture main ${sha(shots.main)} = branch ${sha(shots.branch)} → ${sha(shots.main) === sha(shots.branch) ? "the same pixels" : "DIFFERENT"} · animations the same=${anims.main === anims.branch}`);
    if (dev === "iphone390" && theme === "light") out.push(`    ${anims.branch}`);
  }

  out.push("", bad ? `${bad} BAD` : "all checks ok");
  fs.writeFileSync(path.join(__dirname, "measured.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
