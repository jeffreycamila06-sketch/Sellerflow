// SellerFlow parcel-checker — 賣貨便 EXPORT reader (isolated world).
//
// Receives the exported 匯出報表 .xlsx bytes from the MAIN-world hook (myship-export-hook.js),
// parses the 訂單匯入 tab, and hands the background worker {tracking_no, buyer_username} pairs
// for the Layer-A parcel_tracking upsert (PC_EXPORT_HANDLES → pcUpsertHandles, handle-only).
//
// Why the export (not the on-screen list): the /seller/order list MASKS the recipient name and
// does not expose the handle. The 訂單匯入 tab of the export pairs the F-code (配送單編號) with
// the buyer handle (其它資訊 / FB·LINE·IG) that SellerFlowLive itself wrote into the import
// template — so it round-trips back verbatim, F-code included (minted by 賣貨便 after upload).
//
// Parsing rules (verified against a real export):
//  • .xlsx = ZIP → inflate with DecompressionStream("deflate-raw") (same primitive as
//    shippingXlsmPatch.ts); STORED entries are taken verbatim.
//  • Resolve the 訂單匯入 sheet BY NAME via workbook.xml + workbook.xml.rels (NOT sheet index —
//    the two tabs have different column orders).
//  • Header row = row 3 (rows 1–2 are a title/date/filter banner). Data = rows ≥ 4.
//  • Locate 配送單編號 and 其[他它]資訊 / FB·LINE·IG BY HEADER TEXT, and EXPLICITLY ignore
//    商品名稱 (the middle product column that holds the shop name, e.g. "budgetukay").
//  • Concatenate all <t> runs per <si> (shared strings can be rich text). Ignore the bogus
//    <dimension> (phantom ~1,000 columns); iterate the real <row> elements.
//  • Handle stored VERBATIM (never strip "(IG)"/"line"/"fb"); blank handle → null.
//
// This file is DUAL-MODE: in Chrome (content script) it installs the window-message listener;
// under vitest (node) it exports the pure reader for behavioural tests. No DOM/vitest harness
// runs in the extension itself, so the reader is proven in node against a fixture xlsx.
(function (root) {
  const TAG = "__SFL_EXPORT_XLSX__";
  const IMPORT_SHEET = "訂單匯入";
  const HEADER_ROW = 3;

  // ── pure ZIP reader (central-directory walk; DEFLATE via DecompressionStream, STORED verbatim) ──
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzipXlsx(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = bytes.length - 22;                                   // find End-Of-Central-Directory
    for (; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) break; }
    if (i < 0) throw new Error("not a zip (no EOCD)");
    const cdOff = dv.getUint32(i + 16, true), cdCnt = dv.getUint16(i + 10, true);
    const out = {};
    let p = cdOff;
    for (let n = 0; n < cdCnt; n++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);   // local header's own name/extra lens
      const dataStart = lho + 30 + lnl + lel;
      const raw = bytes.subarray(dataStart, dataStart + csize);
      out[name] = method === 0 ? raw : await inflateRaw(raw);    // 0 = STORED, 8 = DEFLATE
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  // ── XML helpers ──
  const dec = (b) => new TextDecoder("utf-8").decode(b);
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").replace(/&amp;/g, "&");
  function sharedStrings(xml) {
    const out = [];
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = "";
      for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += tm[1];   // concat all runs
      out.push(unesc(t));
    }
    return out;
  }
  const colLetters = (ref) => ref.match(/^[A-Z]+/)[0];
  function importSheetPath(files) {
    const wb = dec(files["xl/workbook.xml"]);
    const rels = dec(files["xl/_rels/workbook.xml.rels"]);
    const s = [...wb.matchAll(/<sheet name="([^"]*)"[^>]*r:id="([^"]*)"/g)].find((m) => m[1] === IMPORT_SHEET);
    if (!s) return null;
    const rel = [...rels.matchAll(/<Relationship Id="([^"]*)"[^>]*Target="([^"]*)"/g)].find((m) => m[1] === s[2]);
    if (!rel) return null;
    return rel[2].startsWith("xl/") ? rel[2] : "xl/" + rel[2];
  }
  function rowsOf(xml, S) {
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rn = +rm[1], cells = {};
      for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>([\s\S]*?)<\/is>)?<\/c>/g)) {
        const col = cm[1], t = cm[2], v = cm[3], is = cm[4];
        let val = "";
        if (is !== undefined) { for (const tm of is.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) val += tm[1]; val = unesc(val); }
        else if (t === "s" && v !== undefined) val = S[+v];
        else if (v !== undefined) val = v;
        cells[col] = val;
      }
      rows.push({ rn, cells });
    }
    return rows;
  }

  // ── core: {tracking_no, buyer_username} from the 訂單匯入 tab ──
  function extractImportHandles(files) {
    const path = importSheetPath(files);
    if (!path || !files[path]) return { rows: [], cols: {} };
    const S = sharedStrings(dec(files["xl/sharedStrings.xml"] || new Uint8Array()));
    const rows = rowsOf(dec(files[path]), S);
    const header = rows.find((r) => r.rn === HEADER_ROW);
    if (!header) return { rows: [], cols: {} };
    let fcodeCol = null, handleCol = null;
    for (const [col, txt] of Object.entries(header.cells)) {
      const h = String(txt || "").replace(/\s+/g, "");
      if (fcodeCol == null && /配送單編號/.test(h)) fcodeCol = col;
      // handle column: 其他/其它資訊 OR the FB/LINE/IG hint — but NEVER the 商品名稱 product column
      else if (handleCol == null && !/商品名稱/.test(h) && (/其[他它]資訊/.test(h) || /FB\/LINE\/IG/.test(h))) handleCol = col;
    }
    if (!fcodeCol) return { rows: [], cols: {} };
    const out = [];
    for (const r of rows) {
      if (r.rn <= HEADER_ROW) continue;
      const tn = String(r.cells[fcodeCol] || "").trim();
      if (!tn) continue;                                        // no F-code → skip (never garbage)
      const hv = handleCol ? String(r.cells[handleCol] || "") : "";
      out.push({ tracking_no: tn, buyer_username: hv.trim() ? hv : null });  // VERBATIM; blank → null
    }
    return { rows: out, cols: { fcodeCol, handleCol } };
  }

  // Pull the same-origin temp export URL out of a candidate string (MR2 response body, an
  // element's src/href, etc.). Resolves relative → absolute against the page origin.
  function matchExportUrl(s) {
    if (typeof s !== "string") return null;
    const m = s.match(/(?:https?:\/\/[^\s"'<>\\]+)?\/i\/temp\/export\/[^\s"'<>\\]+\.xlsx/i);
    if (!m) return null;
    try { return new URL(m[0], typeof location !== "undefined" ? location.origin : "https://myship.7-11.com.tw").href; }
    catch (_) { return null; }
  }

  // ── content-script wiring (browser only) ──
  function install() {
    const SCAN = "__SFL_EXPORT_SCAN__";
    const seen = new Set();
    async function captureExportUrl(url, reason) {
      if (!url || seen.has(url)) return;
      seen.add(url);
      try {
        console.log(`[SFL-EXPORT] fetching temp export (${reason}): ${url}`);
        const res = await fetch(url, { credentials: "include" });   // same-origin → cookies flow
        if (!res.ok) { console.warn(`[SFL-EXPORT] temp export fetch ${res.status} — ${url}`); return; }
        await handleExport(await res.arrayBuffer(), "url:" + reason);
      } catch (e) { console.warn("[SFL-EXPORT] temp export fetch failed:", e && e.message); }
    }
    window.addEventListener("message", (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data[TAG] === true && e.data.bytes) {                    // bytes path (Blob-based downloads)
        handleExport(e.data.bytes, e.data.via).catch((err) => console.warn("[SFL-EXPORT] parse failed (safe):", err && err.message));
      } else if (e.data[SCAN] === true) {                           // URL-scan path (server-generated temp file)
        const u = matchExportUrl(e.data.text);
        if (u) captureExportUrl(u, "scan");
      }
    });
    // Second capture path: watch the DOM for the <iframe src>/<a href> that navigates to the temp file.
    try {
      const scanEl = (el) => { const u = matchExportUrl((el && (el.src || el.href)) || ""); if (u) captureExportUrl(u, "dom"); };
      document.querySelectorAll("iframe[src],a[href]").forEach(scanEl);
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === "attributes") scanEl(m.target);
          m.addedNodes && m.addedNodes.forEach((n) => {
            if (n.nodeType === 1) { scanEl(n); n.querySelectorAll && n.querySelectorAll("iframe[src],a[href]").forEach(scanEl); }
          });
        }
      }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
    } catch (_) { /* observer optional */ }
    console.log("[SFL-EXPORT] reader armed — click 匯出報表 to capture handles.");
  }
  async function handleExport(buf, via) {
    console.log(`[SFL-EXPORT] parsing export (via ${via || "?"}) — ${buf.byteLength} bytes.`);
    const files = await unzipXlsx(new Uint8Array(buf));
    const { rows, cols } = extractImportHandles(files);
    if (!rows.length) {
      console.log("[SFL-EXPORT] no 訂單匯入 handle rows in this export — nothing to send.",
        "sheets:", Object.keys(files).filter((k) => /worksheets\/sheet/.test(k)).length, "cols:", JSON.stringify(cols || {}));
      return;
    }
    chrome.runtime.sendMessage({ type: "PC_EXPORT_HANDLES", rows }, (resp) => {
      if (chrome.runtime.lastError) { console.warn("[SFL-EXPORT] background unreachable:", chrome.runtime.lastError.message); return; }
      console.log(`[SFL-EXPORT] sent ${rows.length} row(s); upsert result:`, JSON.stringify(resp || {}));
    });
  }

  const api = { unzipXlsx, extractImportHandles, sharedStrings, importSheetPath, matchExportUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // node CJS
  try { root.__sflExportReader = api; } catch (_) { /* frozen global — ignore */ }  // vitest/global fallback + debug
  // Install ONLY in the extension's isolated world (chrome.runtime present). Never in node/tests.
  if (typeof chrome !== "undefined" && chrome.runtime && typeof location !== "undefined"
      && /\/seller\/order/i.test(location.pathname)) install();
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
