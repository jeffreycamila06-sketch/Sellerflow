// main (port 5198) vs this branch with the switch OFF (port 5199, ?qlookup=off): same steps, same HTML?
const { chromium } = require("playwright");
async function run(b, base, fm, w) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  const k = fm ? "fms" : "ps";
  await p.goto(base, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.locator("button", { hasText: /^Settings$/ }).last().click();
  await p.waitForTimeout(400);
  await p.click(fm ? '[data-testid="tile-parcelscan-fm-open"]' : '[data-testid="tile-parcelscan"]');
  await p.waitForTimeout(900);
  await p.click(`[data-testid="${k}-manual"]`);
  await p.waitForTimeout(300);
  const png = await p.evaluate((t) => new Promise((res) => {
    const s2 = document.createElement("script"); s2.src = "/node_modules/qrcode-generator/qrcode.js";
    s2.onload = () => { const q = window.qrcode(0, "M"); q.addData(t); q.make(); const n = q.getModuleCount(), sc = 8, qz = 4, W = (n + 2 * qz) * sc;
      const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, W); x.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect((cc + qz) * sc, (r + qz) * sc, sc, sc);
      res(c.toDataURL("image/png").split(",")[1]); };
    document.head.appendChild(s2);
  }), "https://tiktok.com/@maria_shops");
  await p.setInputFiles(`[data-testid="${k}-qr-file"]`, { name: "q.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p.waitForSelector(`[data-testid="${k}-toast"]`, { timeout: 8000 });
  const shots = [];
  for (const ms of [150, 1200]) { // right after the scan, and after any answer would have come
    await p.waitForTimeout(ms);
    shots.push(await p.evaluate((k) => ({
      card: document.querySelector(`[data-testid="${k}-confirm"]`).outerHTML,
      toast: document.querySelector(`[data-testid="${k}-toast"]`)?.outerHTML ?? null,
      focus: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName,
    }), k));
  }
  await p.close();
  return shots;
}
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const fm of [false, true]) for (const w of [360, 1280]) {
    const a = await run(b, "http://localhost:5198/", fm, w);
    const c = await run(b, "http://localhost:5199/?qlookup=off", fm, w);
    for (let i = 0; i < a.length; i++) for (const key of ["card", "toast", "focus"]) {
      const same = a[i][key] === c[i][key];
      if (!same) bad++;
      console.log(`${fm ? "fm " : "711"} ${w}px ${i === 0 ? "right after scan" : "1.3 s later    "} ${key.padEnd(5)}: ${same ? "IDENTICAL" : "DIFFERENT"} (${String(a[i][key]).length} chars)`);
    }
  }
  console.log(bad === 0 ? "ALL IDENTICAL" : `DIFFERENCES: ${bad}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
