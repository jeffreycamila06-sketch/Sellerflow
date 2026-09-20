// SellerFlow parcel-checker — MAIN-world hook for the 賣貨便 匯出報表 export.
//
// The 匯出報表 (order-info) export is generated CLIENT-SIDE in-page. We must capture the
// generated .xlsx bytes regardless of HOW the page hands them to the browser, then forward
// them to the isolated content script (myship-export-711.js) which parses the 訂單匯入 tab.
//
// ⚠️ MUST run in the MAIN world (manifest `"world": "MAIN"`): an isolated content script
// cannot see/patch the page's Blob / URL / anchor APIs. Requires Chrome 111+.
// ⚠️ NON-DISRUPTIVE: every hook calls the ORIGINAL and returns its value unchanged — the
// seller's normal download always happens. We only make our own copy of the bytes.
//
// Multiple capture paths (the site did NOT use URL.createObjectURL alone — hence the fallbacks):
//   1. URL.createObjectURL / webkitURL.createObjectURL  (blob: download URL)
//   2. Blob / File constructor                          (the file object itself, any download method)
//   3. HTMLAnchorElement.click  (blob: / data: href)    (anchor-download, incl. libraries)
//   4. showSaveFilePicker → writable.write              (File System Access API)
//   5. navigator.msSaveOrOpenBlob                        (legacy)
// Each logs which path fired so the owner can see the mechanism in the console.
(function () {
  if (typeof location === "undefined" || !/\/seller\/order/i.test(location.pathname)) return;
  const TAG = "__SFL_EXPORT_XLSX__";
  const LOG = "[SFL-EXPORT]";

  // ── de-dupe: several hooks can see the SAME file (e.g. Blob ctor + createObjectURL + anchor).
  //    Forward only once per (byteLength) within a short window. ──
  let lastSig = 0, lastAt = 0;
  function send(buf, via) {
    const sig = buf.byteLength, now = Date.now();
    if (sig === lastSig && now - lastAt < 4000) { console.log(`${LOG} (dup ${via}) — already forwarded ${sig}B, skipped`); return; }
    lastSig = sig; lastAt = now;
    console.log(`${LOG} captured via ${via} — ${sig} bytes (PK zip). Forwarding to reader.`);
    window.postMessage({ [TAG]: true, bytes: buf, via }, location.origin, [buf]);
  }

  // Only consider blobs that could be an .xlsx (a zip). Skip obvious media/text to cut noise.
  function candidate(blob) {
    if (!(blob instanceof Blob) || blob.size < 4) return false;
    const t = (blob.type || "").toLowerCase();
    if (/^(image|video|audio|font)\/|text\/|application\/(json|javascript)|javascript|css|html/.test(t)) return false;
    return true;
  }
  async function tryForwardBlob(blob, via) {
    try {
      if (!candidate(blob)) return;
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return; // "PK\x03\x04"
      send(await blob.arrayBuffer(), via);
    } catch (_) { /* never break the page */ }
  }
  function tryForwardBuffer(buf, via) {
    try {
      const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
      if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
        send(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), via);
      }
    } catch (_) { /* ignore */ }
  }
  function forwardDataUrl(href, via) {
    try {
      const m = /^data:([^,]*),(.*)$/s.exec(href);
      if (!m) return;
      const isB64 = /;base64/i.test(m[1]);
      const raw = decodeURIComponent(m[2]);
      const bytes = isB64
        ? Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
        : Uint8Array.from(raw, (c) => c.charCodeAt(0));
      tryForwardBuffer(bytes, via);
    } catch (_) { /* ignore */ }
  }

  const installed = [];

  // 1. URL.createObjectURL (+ webkitURL)
  for (const ctor of [typeof URL !== "undefined" ? URL : null, typeof webkitURL !== "undefined" ? webkitURL : null]) {
    if (ctor && ctor.createObjectURL) {
      const orig = ctor.createObjectURL.bind(ctor);
      ctor.createObjectURL = function (obj) {
        const url = orig(obj);                       // real URL first — download untouched
        try { if (obj instanceof Blob) tryForwardBlob(obj, "createObjectURL"); } catch (_) {}
        return url;
      };
      installed.push("createObjectURL");
    }
  }

  // 2. Blob + File constructors (catch-all: the file object exists no matter how it downloads)
  for (const name of ["Blob", "File"]) {
    const Orig = typeof window !== "undefined" ? window[name] : undefined;
    if (typeof Orig === "function") {
      function Patched(...args) { const o = new Orig(...args); try { tryForwardBlob(o, name + "-ctor"); } catch (_) {} return o; }
      Patched.prototype = Orig.prototype;            // preserve instanceof
      try { window[name] = Patched; installed.push(name + "-ctor"); } catch (_) {}
    }
  }

  // 3. HTMLAnchorElement.click — blob: (fetch it) or data: (decode it)
  if (typeof HTMLAnchorElement !== "undefined" && HTMLAnchorElement.prototype.click) {
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        const href = this.href || "";
        if (/^blob:/i.test(href)) { fetch(href).then((r) => r.blob()).then((b) => tryForwardBlob(b, "anchor.click(blob)")).catch(() => {}); }
        else if (/^data:/i.test(href)) { forwardDataUrl(href, "anchor.click(data)"); }
      } catch (_) {}
      return origClick.apply(this, arguments);
    };
    installed.push("anchor.click");
  }

  // 4. File System Access API — showSaveFilePicker → writable.write(chunks)
  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    const origSFP = window.showSaveFilePicker.bind(window);
    window.showSaveFilePicker = async function (...args) {
      const handle = await origSFP(...args);
      try {
        const origCW = handle.createWritable.bind(handle);
        handle.createWritable = async function (...a) {
          const w = await origCW(...a);
          const chunks = [];
          const origWrite = w.write.bind(w);
          w.write = async function (data) { try { chunks.push(data && data.data !== undefined ? data.data : data); } catch (_) {} return origWrite(data); };
          const origClose = w.close.bind(w);
          w.close = async function () { const r = await origClose(); try { tryForwardBlob(new Blob(chunks), "showSaveFilePicker"); } catch (_) {} return r; };
          return w;
        };
      } catch (_) {}
      return handle;
    };
    installed.push("showSaveFilePicker");
  }

  // 5. navigator.msSaveOrOpenBlob / msSaveBlob (legacy)
  for (const name of ["msSaveOrOpenBlob", "msSaveBlob"]) {
    if (typeof navigator !== "undefined" && typeof navigator[name] === "function") {
      const orig = navigator[name].bind(navigator);
      navigator[name] = function (blob, ...rest) { try { tryForwardBlob(blob, name); } catch (_) {} return orig(blob, ...rest); };
      installed.push(name);
    }
  }

  console.log(`${LOG} hooks installed (MAIN world): ${installed.join(", ")}. Click 匯出報表 to capture.`);
})();
