// SellerFlow parcel-checker — MAIN-world hook for the 賣貨便 匯出報表 export.
//
// The 匯出報表 (order-info) export is generated CLIENT-SIDE in-page: the button builds
// the .xlsx in JavaScript and hands it to the browser as a Blob — there is NO network
// request to replicate. So we intercept the Blob the page passes to URL.createObjectURL
// (the standard download path), read its bytes, and forward them to the isolated content
// script (myship-export-711.js), which parses the 訂單匯入 tab and writes the buyer handles.
//
// ⚠️ MUST run in the MAIN world (manifest `"world": "MAIN"`): an isolated content script
// cannot see the page's Blob / patch the page's URL.createObjectURL. Requires Chrome 111+.
//
// ⚠️ NON-DISRUPTIVE: we call the ORIGINAL createObjectURL and return its URL unchanged, so
// the seller's normal download still happens. We only make our own copy of the bytes.
// document_start so the wrapper is installed before the page's export code runs.
(function () {
  if (typeof location === "undefined" || !/\/seller\/order/i.test(location.pathname)) return;
  const TAG = "__SFL_EXPORT_XLSX__";
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = orig(obj);                       // real URL first — download is untouched
    try { if (obj instanceof Blob) maybeForward(obj); } catch (_) { /* never break the page */ }
    return url;
  };

  async function maybeForward(blob) {
    // .xlsx is a ZIP → only forward blobs whose first bytes are the PK local-file signature.
    // (Filters out unrelated object URLs — images, other downloads. The reader self-validates
    // by looking for the 訂單匯入 sheet, so a stray zip just yields zero rows.)
    let head;
    try { head = new Uint8Array(await blob.slice(0, 4).arrayBuffer()); } catch (_) { return; }
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return; // "PK\x03\x04"
    const buf = await blob.arrayBuffer();
    // Transfer the ArrayBuffer to the isolated world (same window). targetOrigin pinned.
    window.postMessage({ [TAG]: true, bytes: buf }, location.origin, [buf]);
  }
})();
