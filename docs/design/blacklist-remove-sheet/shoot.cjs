// The REAL app (preview mode, made-up Blacklist rows from src/dev/fakeSupabase.ts ?bl=1) → Settings →
// Blacklist → tap Remove → the "Remove … from your blacklist?" sheet. On each screen size it checks whether
// Cancel and Remove can really be tapped: the element at the centre of each button must be the button
// itself (not the bottom nav or the screen behind), and the whole button must be on the screen.
//   servers: this branch  npx vite --config vite.preview.config.ts --port 5199
//            main         (a copy of origin/main with the same fakeSupabase.ts) … --port 5200
//   node docs/design/blacklist-remove-sheet/shoot.cjs <before|after> <port>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [, , tag, port] = process.argv;
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
// + a very short screen (390×240, a stress case) to prove the max-height: the long name scrolls inside the sheet, the buttons stay.
const DEVICES = [["iphone390", 390, 844], ["android412", 412, 915], ["laptop1280", 1280, 800], ["short390x240", 390, 240]];
const ROWS = [["short", 0], ["longname", 2]]; // list order: maria_shop, Ana Reyes / the long name (newest first)

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [dev, w, h] of DEVICES) for (const [rowName, idx] of ROWS) {
    if (dev.startsWith("short") && rowName !== "longname") continue;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`http://localhost:${port}/?admin=1&bl=1`, { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    await p.locator("button", { hasText: /^Settings$/ }).last().click();
    await p.waitForTimeout(500);
    await p.click("[data-testid=tile-blacklist]");
    await p.waitForSelector("[data-testid=bl-remove]");
    await p.waitForTimeout(500);
    const label = await p.locator("[data-testid=bl-row]").nth(idx).textContent();
    await p.locator("[data-testid=bl-remove]").nth(idx).click();
    await p.waitForSelector("[data-testid=bl-remove-sheet]");
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const res = {};
      for (const id of ["bl-remove-cancel", "bl-remove-ok"]) {
        const el = document.querySelector(`[data-testid=${id}]`);
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        res[id] = {
          top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
          onScreen: r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw,
          tappable: !!hit && (hit === el || el.contains(hit)),
          coveredBy: hit && hit !== el && !el.contains(hit) ? (hit.closest("[data-testid]")?.getAttribute("data-testid") || hit.tagName.toLowerCase()) : null,
        };
      }
      const nav = [...document.querySelectorAll("nav, [class*=nav]")].map((n) => n.getBoundingClientRect()).filter((r) => r.height > 30 && r.bottom >= vh - 2)[0];
      const sheet = document.querySelector("[data-testid=bl-remove-sheet]");
      const body = document.querySelector("[data-testid=bl-remove-body]");
      return { textScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null, vh, navTop: nav ? Math.round(nav.top) : null, inPortal: !!sheet && !sheet.closest(".sfl-scroll"), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, res };
    });
    const name = `${tag}_${rowName}_${dev}.png`;
    await p.screenshot({ path: path.join(OUT, name) });
    const c = m.res["bl-remove-cancel"], o = m.res["bl-remove-ok"];
    lines.push(`${name}: row "${label.trim().slice(0, 40)}…" · sheet outside the screen's scroll box=${m.inPortal} · bottom nav top=${m.navTop ?? "none"} / screen ${m.vh}px · ` +
      `Cancel ${c.top}–${c.bottom}px tappable=${c.tappable}${c.coveredBy ? ` (covered by ${c.coveredBy})` : ""} onScreen=${c.onScreen} · ` +
      `Remove ${o.top}–${o.bottom}px tappable=${o.tappable}${o.coveredBy ? ` (covered by ${o.coveredBy})` : ""} onScreen=${o.onScreen} · text scrolls inside the sheet=${m.textScrolls ?? "n/a"} · sideways=${m.sideways}px${errs.length ? ` · PAGE ERROR ${errs[0]}` : ""}`);
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname, `${tag}.txt`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
