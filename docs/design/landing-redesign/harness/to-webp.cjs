// Re-encodes the captured PNG screens as WebP (smaller files for the page). Stickers stay PNG (2-colour, tiny).
//   node docs/design/landing-redesign/harness/to-webp.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..", "preview", "assets");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".png") && !x.startsWith("sticker-"))) {
    const src = "data:image/png;base64," + fs.readFileSync(path.join(DIR, f)).toString("base64");
    const out = await p.evaluate(async (s) => {
      const img = new Image(); img.src = s; await img.decode();
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/webp", 0.86);
    }, src);
    const buf = Buffer.from(out.split(",")[1], "base64");
    fs.writeFileSync(path.join(DIR, f.replace(/\.png$/, ".webp")), buf);
    fs.unlinkSync(path.join(DIR, f));
    console.log(f, "→ webp", Math.round(buf.length / 1024) + " KB");
  }
  await b.close();
})();
