// Chrome extension 賣貨便 EXPORT reader (Option 3) — BEHAVIOURAL + structural contract tests.
// The reader (chrome-extension/myship-export-711.js) is dual-mode: content script in Chrome,
// pure CJS exports under node. Here we build a REAL .xlsx (STORED zip + the exact 訂單匯入 shape
// from a live export) and assert it targets 配送單編號 (F-code) + 其它資訊 (handle), IGNORES the
// 商品名稱 product column, keeps the handle verbatim, and maps a blank handle → null. Structural
// pins cover the MAIN-world hook, the manifest wiring, and the handle-only background upsert
// (the extension has no DOM/vitest harness — the server.js-structural convention).
import { describe, it, expect } from "vitest";
// @ts-expect-error node types not in the tests tsconfig (present at runtime)
import { readFileSync } from "node:fs";
// @ts-expect-error node types not in the tests tsconfig (present at runtime)
import { createRequire } from "node:module";

type Reader = {
  unzipXlsx: (b: Uint8Array) => Promise<Record<string, Uint8Array>>;
  extractImportHandles: (files: Record<string, Uint8Array>) => { rows: Array<{ tracking_no: string; buyer_username: string | null }>; cols: { fcodeCol?: string; handleCol?: string } };
  matchExportUrl: (s: string) => string | null;
};
const require = createRequire(import.meta.url);
// Dual-mode file: CJS require gives module.exports; under vitest's ESM transform it also assigns
// a global, so fall back to that.
const required = require("../../../../chrome-extension/myship-export-711.js");
const reader = (required && required.unzipXlsx ? required : (globalThis as unknown as { __sflExportReader: Reader }).__sflExportReader) as Reader;

// ── minimal STORED-zip writer (crc ignored by the reader; DEFLATE inflate is proven separately
//    against the real export) ──
function makeZip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const files = Object.entries(entries).map(([name, text]) => ({ name: enc.encode(name), data: enc.encode(text) }));
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  const push = (arr: Uint8Array[], ...parts: Uint8Array[]) => { for (const p of parts) arr.push(p); };
  for (const f of files) {
    const lho = offset;
    const local = [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(f.data.length), u32(f.data.length), u16(f.name.length), u16(0), f.name, f.data];
    push(chunks, ...local);
    for (const p of local) offset += p.length;
    push(central, u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(f.data.length), u32(f.data.length), u16(f.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(lho), f.name);
  }
  const cdStart = offset;
  let cdSize = 0; for (const p of central) cdSize += p.length;
  const eocd = [u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(cdStart), u16(0)];
  const all = [...chunks, ...central, ...eocd];
  let total = 0; for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// A realistic export: two tabs (非訂單匯入 = sheet1, 訂單匯入 = sheet2), header on ROW 3, and the
// import tab's column order (F-code col H, product col L, handle col V) — the exact live shape.
const SHARED = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<si><t>配送單編號</t></si>`                                   // 0
  + `<si><t>商品名稱&#10;(品名/規格)</t></si>`                      // 1 — the decoy (holds shop name)
  + `<si><t>其它資訊&#10;(FB/LINE/IG帳號)</t></si>`                  // 2 — the handle header (其它, 它 not 他)
  + `<si><t>收件人姓名</t></si>`                                   // 3
  + `</sst>`;
const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
  + `<sheets><sheet name="非訂單匯入" sheetId="1" r:id="rId1"></sheet>`
  + `<sheet name="訂單匯入" sheetId="2" r:id="rId2"></sheet></sheets></workbook>`;
const WB_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Target="worksheets/sheet1.xml" />`
  + `<Relationship Id="rId2" Target="worksheets/sheet2.xml" />`
  + `<Relationship Id="rId5" Target="sharedStrings.xml" /></Relationships>`;
const SHEET1 = `<?xml version="1.0"?><worksheet><dimension ref="A1:AMO3"/><sheetData>`
  + `<row r="3"><c r="H3" t="s"><v>0</v></c></row></sheetData></worksheet>`;  // non-import tab: no handle col
const SHEET2 = `<?xml version="1.0"?><worksheet><dimension ref="A1:AML3"/><sheetData>`
  + `<row r="1"><c r="A1" t="inlineStr"><is><t>訂購日期：2026/07/20~2026/09/20</t></is></c></row>`   // banner
  + `<row r="3">`
  +   `<c r="G3" t="s"><v>3</v></c>`   // 收件人姓名
  +   `<c r="H3" t="s"><v>0</v></c>`   // 配送單編號 (F-code)
  +   `<c r="L3" t="s"><v>1</v></c>`   // 商品名稱 (decoy)
  +   `<c r="V3" t="s"><v>2</v></c>`   // 其它資訊 (handle)
  + `</row>`
  + `<row r="4">`
  +   `<c r="G4" t="inlineStr"><is><t>J*o</t></is></c>`
  +   `<c r="H4" t="inlineStr"><is><t>F836749464</t></is></c>`
  +   `<c r="L4" t="inlineStr"><is><t>budgetukay</t></is></c>`
  +   `<c r="V4" t="inlineStr"><is><t>Ashley102031</t></is></c>`
  + `</row>`
  + `<row r="5">`
  +   `<c r="H5" t="inlineStr"><is><t>F836749265</t></is></c>`
  +   `<c r="V5" t="inlineStr"><is><t>18ingaryg(IG)</t></is></c>`   // verbatim (IG) — must NOT be stripped
  + `</row>`
  + `<row r="6">`
  +   `<c r="H6" t="inlineStr"><is><t>F836748584</t></is></c>`      // blank handle → null
  + `</row>`
  + `</sheetData></worksheet>`;

function sampleXlsx() {
  return makeZip({
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": WB_RELS,
    "xl/sharedStrings.xml": SHARED,
    "xl/worksheets/sheet1.xml": SHEET1,
    "xl/worksheets/sheet2.xml": SHEET2,
  });
}

describe("reader — 訂單匯入 tab, header-text column targeting", () => {
  it("resolves the 訂單匯入 sheet BY NAME and picks 配送單編號=H + 其它資訊=V (NOT 商品名稱=L)", async () => {
    const files = await reader.unzipXlsx(sampleXlsx());
    const { cols } = reader.extractImportHandles(files);
    expect(cols.fcodeCol).toBe("H");
    expect(cols.handleCol).toBe("V");
  });
  it("emits {tracking_no, buyer_username} verbatim; blank handle → null; ignores the budgetukay product column", async () => {
    const files = await reader.unzipXlsx(sampleXlsx());
    const { rows } = reader.extractImportHandles(files);
    expect(rows).toEqual([
      { tracking_no: "F836749464", buyer_username: "Ashley102031" },
      { tracking_no: "F836749265", buyer_username: "18ingaryg(IG)" }, // (IG) kept — never cleaned
      { tracking_no: "F836748584", buyer_username: null },            // blank handle
    ]);
    // the shop-name product column must NEVER leak in as a handle
    expect(rows.some((r) => r.buyer_username === "budgetukay")).toBe(false);
  });
  it("returns nothing when the 訂單匯入 tab is absent (self-validating — never garbage)", async () => {
    const files = await reader.unzipXlsx(makeZip({
      "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="非訂單匯入" sheetId="1" r:id="rId1"></sheet></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" /></Relationships>`,
      "xl/sharedStrings.xml": SHARED,
      "xl/worksheets/sheet1.xml": SHEET1,
    }));
    expect(reader.extractImportHandles(files).rows).toEqual([]);
  });
});

describe("matchExportUrl — pull the same-origin temp export URL out of a candidate string", () => {
  it("extracts /i/temp/export/*.xlsx from a JSON/text response body (relative → absolute, page origin)", () => {
    const body = '{"ok":true,"file":"/i/temp/export/%e8%b3%a3_8v06RHZZUNbM_20260920110841.xlsx"}';
    const out = reader.matchExportUrl(body);
    // resolved against the page origin (jsdom localhost here; myship.7-11.com.tw in Chrome)
    expect(out).toMatch(/^https?:\/\/.+\/i\/temp\/export\/%e8%b3%a3_8v06RHZZUNbM_20260920110841\.xlsx$/);
  });
  it("extracts a full absolute URL from an iframe src attribute string", () => {
    const html = '<iframe src="https://myship.7-11.com.tw/i/temp/export/abc_20260920.xlsx"></iframe>';
    expect(reader.matchExportUrl(html)).toBe("https://myship.7-11.com.tw/i/temp/export/abc_20260920.xlsx");
  });
  it("returns null for unrelated strings (other .xlsx paths, no /i/temp/export)", () => {
    expect(reader.matchExportUrl("/seller/order?tab=pending")).toBeNull();
    expect(reader.matchExportUrl("/some/other/report.xlsx")).toBeNull();
    expect(reader.matchExportUrl("")).toBeNull();
    // @ts-expect-error guard non-strings
    expect(reader.matchExportUrl(null)).toBeNull();
  });
});

describe("MAIN-world hook — non-disruptive Blob capture", () => {
  const hook = readFileSync("chrome-extension/myship-export-hook.js", "utf8");
  it("patches URL.createObjectURL, gates on the PK zip signature, forwards via postMessage", () => {
    expect(hook).toContain("URL.createObjectURL");
    expect(hook).toMatch(/0x50 && head\[1\] === 0x4b && head\[2\] === 0x03 && head\[3\] === 0x04/); // "PK\x03\x04"
    expect(hook).toContain("window.postMessage");
    expect(hook).toContain("__SFL_EXPORT_XLSX__");
  });
  it("returns the ORIGINAL url unchanged (the seller's download is never broken)", () => {
    expect(hook).toMatch(/const url = orig\(obj\);[\s\S]*return url;/);
  });
  it("installs the fallback capture paths (Blob/File ctor, anchor.click, showSaveFilePicker, msSaveBlob, data: decode)", () => {
    expect(hook).toContain("Blob");                        // Blob/File constructor wrap
    expect(hook).toContain("HTMLAnchorElement.prototype.click");
    expect(hook).toContain("showSaveFilePicker");
    expect(hook).toMatch(/msSaveOrOpenBlob|msSaveBlob/);
    expect(hook).toContain("forwardDataUrl");              // data: URL decode path
    expect(hook).toContain("via");                         // each path is logged/labelled
  });
  it("scans XHR/fetch for the server-generated temp export URL (/i/temp/export)", () => {
    expect(hook).toContain("/i/temp/export");
    expect(hook).toContain("__SFL_EXPORT_SCAN__");
    expect(hook).toMatch(/window\.fetch = function/);
    expect(hook).toMatch(/XMLHttpRequest\.prototype\.(open|send)/);
  });
});

describe("manifest — export scripts registered (MAIN hook + isolated reader) on /seller/order*", () => {
  const manifest = JSON.parse(readFileSync("chrome-extension/manifest.json", "utf8"));
  it("hook runs in the MAIN world at document_start", () => {
    const e = manifest.content_scripts.find((c: { js: string[] }) => c.js.includes("myship-export-hook.js"));
    expect(e).toBeTruthy();
    expect(e.world).toBe("MAIN");
    expect(e.run_at).toBe("document_start");
    expect(e.matches).toEqual(["https://myship.7-11.com.tw/seller/order*"]);
  });
  it("reader runs in the isolated world at document_idle", () => {
    const e = manifest.content_scripts.find((c: { js: string[] }) => c.js.includes("myship-export-711.js"));
    expect(e).toBeTruthy();
    expect(e.world).toBeUndefined();   // isolated (default) — needs chrome.runtime
    expect(e.run_at).toBe("document_idle");
  });
});

describe("background — handle-only upsert (never clobbers poller/scraper columns)", () => {
  const background = readFileSync("chrome-extension/background.js", "utf8");
  it("PC_EXPORT_HANDLES reuses the SFL-tab token bridge + pcUpsertHandles", () => {
    const i = background.indexOf('"PC_EXPORT_HANDLES"');
    expect(i).toBeGreaterThan(-1);
    const handler = background.slice(i, i + 700);
    expect(handler).toContain("pcGetToken(sflTabId)");
    expect(handler).toContain("pcUpsertHandles");
  });
  it("pcUpsertHandles sends ONLY user_id/tracking_no/buyer_username (no scraper/poller columns) + drops blank handles", () => {
    const i = background.indexOf("async function pcUpsertHandles");
    expect(i).toBeGreaterThan(-1);
    const fn = background.slice(i, i + 900);
    expect(fn).toContain("on_conflict=user_id,tracking_no");
    expect(fn).toContain("resolution=merge-duplicates");
    expect(fn).toContain("user_id");
    expect(fn).toContain("tracking_no");
    expect(fn).toContain("buyer_username");
    // must not carry the columns owned by the scraper/poller (would clobber under merge-duplicates)
    expect(fn).not.toContain("cm_order_no");
    expect(fn).not.toContain("store_id");
    expect(fn).not.toContain("order_amount");
    expect(fn).not.toContain("recipient_name");
    // blank handles filtered out before the write
    expect(fn).toMatch(/String\(r\.buyer_username\)\.trim\(\) !== ""/);
  });
});
