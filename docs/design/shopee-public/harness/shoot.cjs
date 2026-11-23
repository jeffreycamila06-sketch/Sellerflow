// Shopee Live for every seller (sql/206) — pictures of the REAL app (preview mode: src/dev/fakeSupabase.ts with
// ?shp=<switch>,<beta row>,<plan>,<market>[,shop]; every name is made up). The Live screen's Shopee tile, the
// paste box, Settings → Channels, and the Shopee shops screen.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/shopee-public/harness/shoot.cjs [port]
// The connect answer "plan_expired" is the server's (403) — here it is played back by the browser (no server).
// Also writes shots/measure.txt: sideways scroll and the height of every tap target, per picture.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const i18n = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "src", "redesign", "i18n", "index.tsx"), "utf8");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const word = (key, lang) => {
  const line = i18n.split("\n").find((l) => l.trimStart().startsWith(`${key}:`));
  const m = new RegExp(`(?:"${lang}"|\\b${lang.replace("-", "\\-")}): "((?:[^"\\\\]|\\\\.)*)"`).exec(line);
  return m[1];
};
const DEVICES = [["360", 360, 780], ["390", 390, 844], ["430", 430, 932], ["1280", 1280, 800]];
const LINK = "https://ph.shp.ee/AbCdEf12";

// name → [shp, steps, extra query]
const VIEWS = {
  // ── today (switch off) ──
  off_tile_no_row: ["off,none,basic,PH", ["live"]],
  off_tile_ended_row: ["off,ended,basic,PH", ["live"]],
  off_channels: ["off,none,basic,PH", ["channels"]],
  // ── Shopee for every seller (switch on) ──
  on_tile: ["on,none,basic,PH", ["live"]],
  on_box: ["on,none,basic,PH", ["live", "box"]],
  on_tile_free_plan: ["on,none,free,PH", ["live"]],
  on_tile_ended_row: ["on,ended,basic,PH", ["live"]],
  on_tile_active_row_free_plan: ["on,active,free,PH", ["live"]],
  on_box_plan_ended: ["on,none,expired,PH", ["live", "box", "connect403"]],
  on_box_plan_ended_iphone: ["on,none,expired,PH", ["live", "box", "connect403"], "&ios=1"],
  on_tile_other_market: ["on,none,basic,VN", ["live"]],
  on_channels: ["on,none,basic,PH", ["channels"]],
  on_channels_shop: ["on,none,basic,PH,shop", ["channels"]],
  on_shops_empty: ["on,none,basic,PH", ["channels", "shops"]],
  on_shops_one: ["on,none,basic,PH,shop", ["channels", "shops"]],
};
const DARK = ["on_tile", "on_box", "on_tile_active_row_free_plan", "on_box_plan_ended", "on_channels_shop", "on_shops_one", "off_tile_no_row"];
const ALL_LANGS = ["on_tile", "on_box", "on_tile_active_row_free_plan", "on_box_plan_ended", "on_channels", "on_shops_empty", "on_shops_one"];

(async () => {
  const b = await chromium.launch();
  const lines = [];
  const shoot = async (view, dev, w, h, lang, dark) => {
    const [shp, steps, extra = ""] = VIEWS[view];
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([l, d]) => { try { localStorage.setItem("sfl_rd_lang", l); localStorage.setItem("sfl_rd_theme", d ? "dark" : "light"); } catch { /* preview */ } }, [lang, dark]);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.route("**/shopee/live/connect", (r) => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      return r.fulfill({ status: 403, headers: cors, contentType: "application/json", body: JSON.stringify({ ok: false, error: "plan_expired" }) });
    });
    await p.goto(`http://localhost:${port}/?shp=${shp}${extra}`, { waitUntil: "networkidle" });
    await p.waitForSelector("[data-testid=lpk-tile-sh]");
    await p.waitForTimeout(900);
    // an expired plan opens the app's own "plan expired" pop-up first: close it as the seller would
    if (await p.locator("[data-testid=expiry-close]").count()) { await p.click("[data-testid=expiry-close]"); await p.waitForTimeout(300); }
    for (const step of steps) {
      if (step === "box") { await p.click("[data-testid=lpk-tile-sh]"); await p.waitForSelector("[data-testid=sh-link-input]"); await p.waitForTimeout(2400); } // the box pops in 1.25 s after the tap
      if (step === "connect403") {
        await p.fill("[data-testid=sh-link-input]", LINK);
        await p.click("[data-testid=sh-link-connect]");
        await p.waitForTimeout(3200); // the box is hidden while the connect runs, then pops in again
      }
      if (step === "channels") {
        await p.locator("button", { hasText: new RegExp(`^${word("rd_nav_settings", lang)}$`) }).last().click();
        await p.waitForTimeout(500);
        await p.locator("button", { hasText: word("rd_sh_general", lang) }).first().click();
        await p.waitForSelector("[data-testid=cg-grid]");
        await p.locator("[data-testid=cg-grid]").scrollIntoViewIfNeeded();
        await p.waitForTimeout(500);
      }
      if (step === "shops") { await p.click("[data-testid=cg-shopee]"); await p.waitForSelector("[data-screen=shopeeshops]"); await p.waitForTimeout(600); }
    }
    const m = await p.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid=${id}]`);
      const hOf = (id) => { const e = q(id); return e ? Math.round(e.getBoundingClientRect().height) : null; };
      const txt = (id) => { const e = q(id); return e ? (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90) : null; };
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        tile: hOf("lpk-tile-sh"), tileOff: q("lpk-tile-sh") ? q("lpk-tile-sh").disabled : null, tileText: txt("lpk-tile-sh"),
        connect: hOf("sh-link-connect"), input: hOf("sh-link-input"), error: txt("sh-link-error"),
        box: hOf("cg-shopee"), boxOff: q("cg-shopee") ? q("cg-shopee").disabled : null, boxLine: txt("cg-shopee-line"),
      };
    });
    const name = `${view}_${dev}${lang === "en" ? "" : `_${lang}`}${dark ? "_dark" : ""}.png`;
    await p.screenshot({ path: path.join(OUT, name) });
    const parts = [`sideways scroll=${m.sideways}`];
    if (m.tile != null) parts.push(`Shopee tile ${m.tile}px ${m.tileOff ? "(off)" : "(tappable)"} "${m.tileText}"`);
    if (m.connect != null) parts.push(`link field ${m.input}px · Connect ${m.connect}px`);
    if (m.error) parts.push(`box line "${m.error}"`);
    if (m.box != null) parts.push(`Channels Shopee box ${m.box}px ${m.boxOff ? "(off)" : "(tappable)"} "${m.boxLine}"`);
    if (errs.length) parts.push(`PAGE ERRORS: ${errs.join(" | ").slice(0, 200)}`);
    lines.push(`${name}: ${parts.join(" · ")}`);
    await ctx.close();
  };
  for (const view of Object.keys(VIEWS)) for (const [dev, w, h] of DEVICES) await shoot(view, dev, w, h, "en", false);
  for (const view of DARK) for (const [dev, w, h] of [DEVICES[1], DEVICES[3]]) await shoot(view, dev, w, h, "en", true);
  for (const view of ALL_LANGS) for (const lang of LANGS.slice(1)) await shoot(view, "360", 360, 780, lang, false);
  fs.writeFileSync(path.join(OUT, "measure.txt"), lines.join("\n") + "\n");
  console.log(lines.length, "pictures");
  console.log(lines.filter((l) => /sideways scroll=true|PAGE ERRORS/.test(l)).join("\n") || "no sideways scroll, no page errors");
  await b.close();
})();
