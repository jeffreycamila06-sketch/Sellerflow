// Times the QR reader in a REAL browser engine (Chromium; no BarcodeDetector on Linux = the same path as
// iPhone: the WebAssembly reader). 12 MP and 48 MP JPEG photos; a cold first scan (the reader loads) and
// warm scans; main's reader on the same photos. Desktop CPU — an iPhone is slower (see README).
//   npx vite --config docs/design/qr-read-iphone/harness/vite.config.mjs --port 5335
//   node docs/design/qr-read-iphone/speed.cjs <folder with the JPEG photos>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const D = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const out = [];
  const sizes = {};
  const p = await b.newPage();
  p.on("response", async (r) => { const u = r.url(); if (/zxing|jsQR|jsqr/.test(u)) { try { sizes[u.split("/").pop().split("?")[0]] = (await r.body()).length; } catch { /* */ } } });
  await p.goto("http://localhost:5335/docs/design/qr-read-iphone/harness/speed.html");
  await p.waitForFunction(() => window.__ready === true);
  out.push(`BarcodeDetector in this browser: ${await p.evaluate(() => "BarcodeDetector" in window)}  (false = the iPhone path)`);
  await p.setInputFiles("#f", [path.join(D, "one_12mp.jpg")]);
  out.push(`COLD first scan (reader not loaded yet): ${JSON.stringify(await p.evaluate(() => window.__run("new")))}`);
  for (const tag of ["12mp", "48mp"]) {
    await p.setInputFiles("#f", ["one", "two", "three", "curved", "noqr"].map((n) => path.join(D, `${n}_${tag}.jpg`)));
    for (const which of ["new", "main"]) for (const r of await p.evaluate((w) => window.__run(w), which)) out.push(`${which.padEnd(4)} ${tag} ${JSON.stringify(r)}`);
  }
  out.push(`files fetched for the reader (dev server, not compressed): ${JSON.stringify(sizes)}`);
  fs.writeFileSync(path.join(__dirname, "proof", "speed-browser.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
