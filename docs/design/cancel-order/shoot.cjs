// The REAL app (preview mode, made-up seller + buyers) for Cancel order (sql/234), Orders tab:
//   1) the list: ⋯ on every tagged order, buyer #2's order already Cancelled (struck through, Undo)
//   2) ⋯ → the question sheet (with the "already sent" warning line: &cxsent=1)
//   3) Cancel order → the row turns Cancelled + the toast
// iPhone 390 (?ios=1), Android 412, small phone 360, laptop 1280, + dark. Measured: nothing wider than the
// screen, the sheet's buttons ≥ 44 px tall, the ⋯ tap area ≥ 44 px.
//   server:  node_modules/.bin/vite --config vite.preview.config.ts --port 5199
//   NODE_PATH=/opt/node-tools/node_modules node docs/design/cancel-order/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

async function open(b, { w, h, theme = "light", ios = false, android = false, sent = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, and]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* */ }
    if (and) window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} };
  }, [theme, android]);
  await p.goto(`http://localhost:${port}/?ivc=6,0&cx=1${sent ? "&cxsent=1" : ""}${ios ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
  await wait(p, 1200);
  for (let i = 0; i < 10 && !(await p.locator("[data-testid=ord-more]").count()); i++) {
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^Orders$/i.test((x.textContent || "").trim()) || (x.textContent || "").trim().endsWith("Orders")); b && b.click(); });
    await wait(p, 500);
  }
  return { p, errs, ctx };
}
async function measure(p, w, label) {
  return p.evaluate(([w, label]) => {
    const wide = document.documentElement.scrollWidth > w + 1 ? `page ${document.documentElement.scrollWidth}px` : "";
    const btns = [...document.querySelectorAll("[data-testid=ord-cx-keep],[data-testid=ord-cx-yes]")].map((b) => Math.round(b.getBoundingClientRect().height));
    const more = document.querySelector("[data-testid=ord-more]");
    let tapArea = "";
    if (more) {
      const st = getComputedStyle(more, "::after"); const r = more.getBoundingClientRect();
      tapArea = `⋯ ${Math.round(r.width)}×${Math.round(r.height)} drawn, tap area ${st.content !== "none" ? `${Math.round(r.width + 6)}×${Math.max(Math.round(r.height), parseFloat(st.height) || 0)}` : "none"}`;
    }
    const sheet = document.querySelector("[data-testid=ord-cx-sheet] [role=dialog]");
    const sw = sheet ? `sheet ${Math.round(sheet.getBoundingClientRect().width)}px` : "";
    return `${label}: ${wide || "no sideways scroll"} ${sw} ${btns.length ? `buttons ${btns.join("/")}px` : ""} ${tapArea}`.trim();
  }, [w, label]);
}

(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const lines = [];
  const views = [
    { name: "iphone-390", w: 390, h: 844, ios: true },
    { name: "android-412", w: 412, h: 915, android: true },
    { name: "phone-360", w: 360, h: 760 },
    { name: "laptop-1280", w: 1280, h: 820 },
    { name: "iphone-390-dark", w: 390, h: 844, ios: true, theme: "dark" },
  ];
  for (const v of views) {
    const { p, errs, ctx } = await open(b, { ...v, sent: true });
    await p.screenshot({ path: path.join(OUT, `${v.name}-1-list.png`) });
    lines.push(await measure(p, v.w, `${v.name} list`));
    await tap(p, "[data-testid=ord-more]");
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-2-sheet-sent.png`) });
    lines.push(await measure(p, v.w, `${v.name} sheet`));
    await tap(p, "[data-testid=ord-cx-yes]");
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-3-cancelled.png`) });
    lines.push(await measure(p, v.w, `${v.name} after cancel`));
    lines.push(`${v.name} chips=${await p.locator("[data-testid=ord-cx-chip]").count()} undo=${await p.locator("[data-testid=ord-cx-undo]").count()} errors=${errs.length ? errs.join(" | ") : "none"}`);
    await ctx.close();
  }
  // the sheet without the warning (nothing sent yet), iPhone
  const { p, ctx } = await open(b, { w: 390, h: 844, ios: true });
  await tap(p, "[data-testid=ord-more]");
  await wait(p, 600);
  await p.screenshot({ path: path.join(OUT, "iphone-390-2b-sheet-plain.png") });
  lines.push(`plain sheet warning lines=${await p.locator("[data-testid=ord-cx-sent]").count()}`);
  await ctx.close();
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
