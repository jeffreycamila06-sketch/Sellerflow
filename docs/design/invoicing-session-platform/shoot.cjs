// The REAL app (preview mode, made-up seller and buyers) — Invoicing session picker PER PLATFORM:
//   the running session is TikTok only; past sessions: two TikTok + two Facebook (src/dev/fakeSupabase.ts
//   ?ivc=6,2&fbsa=1&ivcplat=1). Pictures: TikTok tab with the session list open ("This session" + TikTok
//   sessions only) and Facebook tab (its newest Facebook session shown, the list = Facebook sessions only, no
//   "This session") — iPhone 390 (?ios=1), Android 360, laptop 1280; light + dark on iPhone.
// Plus measured checks: no page wider than the screen, every list row ≥ 44 px, the lists themselves.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/invoicing-session-platform/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);

async function open(b, { w, h, theme = "light", ios = false, android = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, and]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* nothing */ }
    window.open = () => null;
    if (and) window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} };
  }, [theme, android]);
  await p.route("**/fb/access**", (r) => r.fulfill({ json: { ok: true, facebook: true, receipt: true } }));
  await p.route("**/fb/sendall/status**", (r) => r.fulfill({ json: { ok: true, access: true, allowed: true, needsMessaging: false, job: null,
    buyers: [{ n: 1, tag: "sent", at: "2026-11-23T09:04:00.000Z" }, { n: 2, tag: "not_sent" }, { n: 3, tag: "not_sent" }, { n: 4, tag: "other_app" }, { n: 5, tag: "not_sent" }, { n: 6, tag: "not_sent" }] } }));
  await p.goto(`http://localhost:${port}/?ivc=6,2&fbsa=1&ivcplat=1&admin=1${ios ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
  await wait(p, 900);
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
    await wait(p, 400);
  }
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-session-btn]");
  await wait(p, 500);
}
const openMenu = async (p) => { await tap(p, "[data-testid=ivc-session-btn]"); await p.waitForSelector("[data-testid=ivc-session-item]"); await wait(p, 300); };
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const wide = document.documentElement.scrollWidth > vw + 1;
  const menu = [...document.querySelectorAll("[data-testid=ivc-session-current],[data-testid=ivc-session-item]")];
  const short = menu.filter((x) => x.getBoundingClientRect().height < 44).length;
  return {
    wide, short,
    label: (document.querySelector("[data-testid=ivc-session-label]") || {}).textContent,
    current: !!document.querySelector("[data-testid=ivc-session-current]"),
    items: menu.filter((x) => x.getAttribute("data-testid") === "ivc-session-item").map((x) => x.textContent.trim()),
  };
});

(async () => {
  const b = await chromium.launch();
  const lines = [];
  const DEV = [["iphone390", 390, 844, { ios: true }, ["light", "dark"]], ["android360", 360, 800, { android: true }, ["light"]], ["laptop1280", 1280, 860, {}, ["light"]]];
  for (const [name, w, h, o, themes] of DEV) for (const theme of themes) {
    const { p, errs, ctx } = await open(b, { w, h, theme, ...o });
    await toInvoicing(p);
    await openMenu(p);
    await p.screenshot({ path: path.join(OUT, `tiktok_${name}_${theme}.png`), fullPage: true });
    const tt = await measure(p);
    lines.push(`tiktok ${name} ${theme}: label="${tt.label}" thisSession=${tt.current} list=[${tt.items.join(" | ")}] wide=${tt.wide} rowsUnder44=${tt.short}`);
    await tap(p, "[data-testid=ivc-tab-facebook]");
    await p.waitForSelector("[data-testid=ivc-fb-list]");
    await wait(p, 500);
    await p.screenshot({ path: path.join(OUT, `facebook_${name}_${theme}.png`), fullPage: true });
    await openMenu(p);
    await p.screenshot({ path: path.join(OUT, `facebook_menu_${name}_${theme}.png`), fullPage: true });
    const fb = await measure(p);
    lines.push(`facebook ${name} ${theme}: label="${fb.label}" thisSession=${fb.current} list=[${fb.items.join(" | ")}] wide=${fb.wide} rowsUnder44=${fb.short} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
