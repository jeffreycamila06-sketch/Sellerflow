// SellerFlow parcel-checker — E-Map MAIN-world helper (1.14.1).
// Runs in the PAGE world (not subject to the page's CSP, unlike an injected
// inline <script>), reads the runtime `eshopGuid` global and hands it to the
// isolated content script (emap-711.js) over a DOM CustomEvent. It never
// touches the page otherwise: no fetch, no DOM writes, no storage.
(function sellerFlowEmapGuidMain() {
  if (window.__sflEmapGuidMain) return;
  window.__sflEmapGuidMain = true;
  var NAMES = ["eshopGuid", "eshopguid", "EshopGuid", "Guid", "guid"];
  function read() {
    for (var i = 0; i < NAMES.length; i++) {
      try {
        var v = window[NAMES[i]];
        if (typeof v === "string" && v.length >= 8) return { guid: v, source: "main:" + NAMES[i] };
      } catch (e) { /* cross-origin / getter throw — try the next name */ }
    }
    return { guid: null, source: null };
  }
  // 1.16.0 — the page's MODE globals (normal 賣貨便 map: storecategory "", eshopparid/eshopid
  // "7M0"; 7-11 frozen picker: 27 / 870 / 870). Values only, as strings; never the guid twice.
  function mode() {
    var out = {};
    var names = ["storecategory", "eshopparid", "eshopid"];
    for (var i = 0; i < names.length; i++) {
      try {
        var v = window[names[i]];
        out[names[i]] = (typeof v === "string" || typeof v === "number") ? String(v) : null;
      } catch (e) { out[names[i]] = null; }
    }
    return out;
  }
  function reply() {
    var r = read();
    r.mode = mode();
    try { document.dispatchEvent(new CustomEvent("__sfl_emap_guid", { detail: r })); } catch (e) { /* page without CustomEvent — nothing to do */ }
  }
  document.addEventListener("__sfl_emap_guid_req", reply);
  reply();
})();
