// REAL screens, REAL reader, REAL photos: the generated sticker photos (JPEG, 12 MP and 48 MP — see
// README) are given to the Scan QR input of 7-11 Parcel Scan, FamilyMart Parcel Scan and Blacklist, on
// this branch AND on main, and what each screen then says is written down. Pictures of this branch.
//   servers: this branch  npx vite --config vite.preview.config.ts --port 5199
//                         npx vite --config docs/design/qr-read-iphone/harness/vite.config.mjs --port 5335
//            main (a worktree of origin/main, same two commands)            --port 5200 / --port 5336
//   node docs/design/qr-read-iphone/shoot.cjs <folder with the JPEG photos>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const PHOTOS = process.argv[2];
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const TARGETS = [
  { id: "branch", app: "http://localhost:5199", bl: "http://localhost:5335" },
  { id: "main", app: "http://localhost:5200", bl: "http://localhost:5336" },
];
const PH = ["one_12mp", "two_12mp", "three_12mp", "curved_12mp", "noqr_12mp", "two_48mp", "three_48mp", "curved_48mp", "one_48mp"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["android430", 430, 932], ["laptop1280", 1280, 800]];

// The bottom-nav "Settings" word in each language (read from the app's own texts).
const I18N = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "redesign", "i18n", "index.tsx"), "utf8");
const navSettings = (lang) => {
  const line = I18N.split("\n").find((l) => l.trim().startsWith("rd_nav_settings:"));
  const m = new RegExp(`(?:^|[{,]\\s*)"?${lang.replace("-", "\\-")}"?:\\s*"([^"]+)"`).exec(line.slice(line.indexOf("{")));
  return m ? m[1] : "Settings";
};
async function openScan(p, base, kind, lang) {
  await p.addInitScript((l) => { try { localStorage.setItem("sfl_rd_lang", l); } catch { /* */ } }, lang);
  if (kind === "bl") {
    await p.goto(`${base}/docs/design/blacklist/built/harness/index.html?view=bl&lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    await p.click("[data-testid=bl-reason-return]");
    return;
  }
  await p.goto(`${base}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.locator("button", { hasText: new RegExp(`^${navSettings(lang)}$`) }).last().click();
  await p.waitForTimeout(400);
  await p.click(kind === "fm" ? "[data-testid=tile-parcelscan-fm-open]" : "[data-testid=tile-parcelscan]");
  await p.waitForTimeout(900);
  await p.click(kind === "fm" ? "[data-testid=fms-manual]" : "[data-testid=ps-manual]");
  await p.waitForTimeout(300);
}
// Give the photo; wait for what the screen says; scroll it into view. Returns { said, filled, ms }.
async function scan(p, kind, photo) {
  const file = path.join(PHOTOS, `${photo}.jpg`);
  const t0 = Date.now();
  if (kind === "bl") {
    await p.setInputFiles("[data-testid=bl-file]", file);
    const sel = "[data-testid=bl-added], [data-testid=bl-qr-many], [data-testid=bl-noqr-found], [data-testid=bl-noqr], [data-testid=bl-err]";
    const el = await p.waitForSelector(sel, { timeout: 60000 });
    const ms = Date.now() - t0;
    await el.scrollIntoViewIfNeeded();
    return { said: (await el.textContent()).trim(), filled: "", ms };
  }
  const k = kind === "fm" ? "fms" : "ps";
  await p.setInputFiles(`[data-testid=${k}-qr-file]`, file);
  const el = await p.waitForSelector(`[data-testid=${k}-toast]`, { timeout: 60000 });
  const ms = Date.now() - t0;
  const said = (await el.textContent()).trim();
  // the @username box (with Buyer contact on, it is the contact box)
  const filled = await p.locator(`[data-testid=${k}-bc-input], [data-testid=${kind === "fm" ? "fms-username" : "ps-notes"}]`).first().inputValue({ timeout: 5000 });
  await p.evaluate((k) => { const t = document.querySelector(`[data-testid=${k}-toast]`); if (t) t.scrollIntoView({ block: "center" }); }, k);
  return { said, filled, ms };
}
async function check(p) {
  return p.evaluate(() => {
    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const cut = [];
    for (const e of document.querySelectorAll("[data-testid$=-toast], [data-testid=bl-qr-many], [data-testid=bl-noqr-found]")) if (e.scrollWidth > e.clientWidth + 1) cut.push(e.dataset.testid);
    return { sideways, cut };
  });
}

(async () => {
  const b = await chromium.launch();
  const lines = [];
  // 1) every photo × every screen × branch / main (English, iPhone width)
  for (const t of TARGETS) for (const kind of ["711", "fm", "bl"]) for (const photo of PH) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await openScan(p, kind === "bl" ? t.bl : t.app, kind, "en");
    let r;
    try { r = await scan(p, kind, photo); } catch (e) { r = { said: `ERROR ${e.message.split("\n")[0]}`, filled: "", ms: 0 }; }
    lines.push(`${t.id.padEnd(6)} ${kind.padEnd(3)} ${photo.padEnd(12)} → "${r.said}"${r.filled ? `  [username: ${r.filled}]` : ""}  (${r.ms} ms)${errs.length ? `  PAGE ERROR: ${errs[0]}` : ""}`);
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname, "compare-with-main.txt"), lines.join("\n") + "\n");
  // 2) pictures of this branch: 2 stickers / curved / no QR on 4 widths (English) + 2 stickers in 8 languages at 360
  const shots = [];
  for (const [dev, w, h] of DEVICES) for (const kind of ["711", "fm", "bl"]) for (const photo of ["two_12mp", "curved_12mp", "noqr_12mp"]) shots.push([dev, w, h, kind, photo, "en"]);
  for (const lang of ["fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) for (const kind of ["711", "bl"]) shots.push(["android360", 360, 800, kind, "two_12mp", lang]);
  const checks = [];
  for (const [dev, w, h, kind, photo, lang] of shots) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await openScan(p, kind === "bl" ? TARGETS[0].bl : TARGETS[0].app, kind, lang);
    const r = await scan(p, kind, photo);
    await p.waitForTimeout(150);
    const c = await check(p);
    const name = `${kind}_${photo.replace("_12mp", "")}_${dev}_${lang}.png`;
    await p.screenshot({ path: path.join(OUT, name) });
    checks.push(`${name}: "${r.said}" sideways=${c.sideways}px cut=${c.cut.length ? c.cut.join(",") : "none"}`);
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname, "shots.txt"), checks.join("\n") + "\n");
  await b.close();
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
