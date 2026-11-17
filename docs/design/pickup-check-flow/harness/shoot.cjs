// node docs/design/pickup-check-flow/harness/shoot.cjs — TODAY (main, port 5311) vs NEW (branch, port 5310),
// iPhone 390 / Android 360 / laptop 1280. Start both servers first (see vite.config.mjs; TODAY = a main
// worktree with this harness copied in). Prints the horizontal overflow of each page.
// Optional args: node shoot.cjs [today|new] [scene numbers, e.g. 5,6] — only those.
const { chromium } = require("playwright");
const JSZip = require("jszip");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..");
const ONLY_ENV = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
const ONLY_SCENES = process.argv[3] ? new Set(process.argv[3].split(",").map(Number)) : null;
const want = (n) => !ONLY_SCENES || ONLY_SCENES.has(n);
const ENVS = [["today", 5311], ["new", 5310]].filter(([e]) => !ONLY_ENV || e === ONLY_ENV);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];

// A 賣貨便 匯出報表 with 4 new parcels on the 訂單匯入 tab (header row 3) — same shape the reader expects.
async function exportFile() {
  const z = new JSZip();
  z.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="訂單匯入" sheetId="1" r:id="rId1"></sheet></sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" /></Relationships>`);
  const cell = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  // Columns as in the real file: G 收件人姓名, H 配送單編號, K 取件門市, P 小計(A), R 商品總額(A+B), V 其它資訊.
  // The store values are made up (the real file's store format is not known yet).
  const data = [["F83674900001", "anna.lim", "中壢華強門市", "410"], ["F83674900002", "bea_closet", "朝陽門市", "260"],
    ["F83674900003", "carla88", "新竹光復門市", "560"], ["F83674900004", "dina_pre", "板橋門市", "199"]]
    .map(([f, h, s, a], i) => `<row r="${4 + i}">${cell(`G${4 + i}`, "王小明")}${cell(`H${4 + i}`, f)}${cell(`K${4 + i}`, s)}${cell(`P${4 + i}`, "999")}${cell(`R${4 + i}`, a)}${cell(`V${4 + i}`, h)}</row>`).join("");
  z.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData><row r="3">${cell("G3", "收件人姓名")}${cell("H3", "配送單編號")}${cell("K3", "取件門市")}${cell("P3", "小計&#10;(A)")}${cell("R3", "商品總額&#10;(A+B)")}${cell("V3", "其它資訊(FB/LINE/IG帳號)")}</row>${data}</sheetData></worksheet>`);
  return z.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

(async () => {
  const xlsx = await exportFile();
  const b = await chromium.launch();
  for (const [env, port] of ENVS) for (const [dev, w, h] of DEVICES) {
    const narrow = w < 700;
    const open = async (scene) => {
      const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await p.goto(`http://localhost:${port}/docs/design/pickup-check-flow/harness/index.html?scene=${scene}${env === "today" ? "&today=1" : ""}`, { waitUntil: "networkidle" });
      await p.waitForSelector(scene === "empty" ? "[data-testid=pt-empty]" : narrow ? "[data-testid=pt-cards]" : "[data-testid=pt-tabs]");
      return p;
    };
    const shot = async (p, name) => {
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = `${name}_${dev}_${env}.png`;
      console.log(`${file}: horizontal overflow ${over}px`);
      await p.screenshot({ path: path.join(OUT, file) });
    };
    let p;
    if (want(1) || want(2)) {
      // 1. counts + the Waiting list (opens on Waiting)
      p = await open("counts");
      if (want(1)) await shot(p, "1-counts-waiting");
      // 2. the In transit list
      await p.click(narrow ? "[data-testid=pt-card-transit]" : "[data-testid=pt-tab-transit]");
      await p.waitForTimeout(300);
      if (want(2)) await shot(p, "2-counts-transit");
      await p.close();
    }
    if (want(3)) {
      // 3. a press that found nothing checkable (the status poll reads the finished job after ~15 s)
      p = await open("toast");
      await p.waitForSelector("[data-testid=pt-toast]", { timeout: 25000 });
      await shot(p, "3-toast-nothing");
      await p.close();
    }
    if (want(4)) {
      // 4. a 7-11 Sync of 4 new parcels
      p = await open("sync");
      await p.setInputFiles("[data-testid=pt-sync-file]", { name: "export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx });
      await p.waitForSelector("[data-testid=pt-toast]", { timeout: 10000 });
      await p.waitForTimeout(800);
      await shot(p, "4-sync-toast");
      await p.close();
    }
    if (want(5)) {
      // 5. "How to sync?" opened (rd_pt_sync_s4)
      p = await open("counts");
      await p.click("[data-testid=pt-sync-how-toggle]");
      await p.waitForSelector("[data-testid=pt-sync-how]");
      await shot(p, "5-how-to-sync");
      await p.close();
    }
    if (want(7)) {
      // 7. just synced: the 4 new parcels under In transit, with the pickup store and the amount from the file
      p = await open("sync");
      await p.setInputFiles("[data-testid=pt-sync-file]", { name: "export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx });
      await p.waitForSelector("[data-testid=pt-toast]", { timeout: 10000 });
      await p.click(narrow ? "[data-testid=pt-card-transit]" : "[data-testid=pt-tab-transit]");
      await p.waitForTimeout(500);
      if (narrow) await p.evaluate(() => document.querySelector("[data-testid=pt-row]")?.scrollIntoView({ block: "start" }));
      await shot(p, "7-synced-store-amount");
      await p.close();
    }
    if (want(6)) {
      // 6. no parcels yet (rd_pt_empty_s3)
      p = await open("empty");
      await shot(p, "6-empty");
      await p.close();
    }
  }
  await b.close();
})();
