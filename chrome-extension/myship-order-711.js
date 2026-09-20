// SellerFlow parcel-checker — 賣貨便 ORDER-LIST scraper (myship.7-11.com.tw).
// Runs in Jeff's logged-in 賣貨便 seller order-list tab (/seller/order*), AUTO on
// page load. Scrapes each order row's parcel code (交貨便服務代碼 / 物流條碼 — an
// alphanumeric code, NEVER assume an F prefix: E-codes exist, e.g. E79829464311),
// CM order number, recipient name, store, and amount, then hands the rows to the
// background worker to UPSERT into parcel_tracking (the poller fills status later).
//
// ⚠️ CROSS-ORIGIN AUTH: a myship content script cannot read the SFL tab's Supabase
// token (different origin). So it POSTs the scraped rows to background.js, which
// pulls Jeff's token from the SFL tab (the existing single-refresher bridge) and
// does the REST upsert. This script never touches the token.
//
// ⚠️ FAIL-SAFE: if the order table isn't found (not logged in / different page /
// changed markup) it scrapes nothing and posts nothing — never garbage. Rows
// missing a parcel code are skipped.
//
// ⚠️ DOM SELECTORS ARE BEST-EFFORT — verify against the real /seller/order markup.
// Matching is by HEADER TEXT (配送方式 / 訂單編號 / 收件人 / 門市 / 金額), not fixed
// column indexes, so it survives column reordering; but if the table structure is
// very different this yields 0 rows (safe no-op). It LOGS a summary so Jeff can see
// what it found.
(function sellerFlowOrderScraper() {
  if (!/\/seller\/order/i.test(location.pathname)) return; // belt-and-suspenders vs the manifest match
  const PAGE_DELAY_MS = 900;   // gentle pause between page advances (never hammer)
  const MAX_PAGES = 200;       // safety cap
  const TAG = "[SFL-ORDER]";

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  // Parcel code: an alphanumeric token of length 8 / 11 / 12 that contains BOTH a
  // letter and a digit (so it can't be a pure-numeric CM/amount/date). NEVER assume
  // an F prefix — E-codes exist. Returns the (upper-cased) code or null.
  function parseParcelCode(text) {
    const tokens = norm(text).match(/[A-Za-z0-9]{8,12}/g) || [];
    for (const tok of tokens) {
      if ((tok.length === 8 || tok.length === 11 || tok.length === 12) && /[A-Za-z]/.test(tok) && /\d/.test(tok)) {
        return tok.toUpperCase();
      }
    }
    return null;
  }
  const parseCm = (text) => { const m = norm(text).match(/CM[0-9]+(?:-[0-9]+)?/i); return m ? m[0].toUpperCase() : null; };
  const parseAmount = (text) => { const m = norm(text).replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  // Prefer a 6-digit store CODE (matches shipping_entries.store_id / the DB link);
  // fall back to the store NAME when the cell shows only a name.
  function parseStore(text) {
    const t = norm(text);
    const code = t.match(/\b\d{6}\b/);
    return { store: code ? code[0] : (t || null), hasCode: !!code };
  }

  // Map a table's header cells (訂單管理 order list) to column indexes by TEXT.
  function headerMap(table) {
    const heads = Array.from(table.querySelectorAll("thead th, thead td"));
    if (!heads.length) return null;
    const map = {};
    heads.forEach((th, i) => {
      const h = norm(th.textContent);
      if (map.code == null && /配送方式|物流|服務代碼|貨態/.test(h)) map.code = i;
      else if (map.cm == null && /訂單編號|訂單號/.test(h)) map.cm = i;
      else if (map.name == null && /收件人|取件人|買家|姓名/.test(h)) map.name = i;
      else if (map.store == null && /門市/.test(h)) map.store = i;
      else if (map.amount == null && /金額|總計|應收|貨款/.test(h)) map.amount = i;
      // ⚠️ NO buyer-handle capture here (removed). The on-screen /seller/order list MASKS the
      // recipient name and does not reliably expose the handle; the SINGLE handle source is now
      // the 匯出報表 EXPORT reader (myship-export-711.js → PC_EXPORT_HANDLES → buyer_username).
      // This scraper stays the source for tracking_no + cm_order_no + store_id + order_amount only.
    });
    return map.code != null ? map : null; // the parcel code column is required
  }
  function findOrderTable() {
    for (const t of Array.from(document.querySelectorAll("table"))) { if (headerMap(t)) return t; }
    return null;
  }

  let sawStoreCodeWarning = false;
  function scrapeCurrentPage() {
    const table = findOrderTable();
    if (!table) return [];
    const map = headerMap(table);
    const out = [];
    for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(tr.children);
      const cell = (i) => (i != null && cells[i] ? norm(cells[i].textContent) : "");
      const tracking_no = parseParcelCode(cell(map.code));
      if (!tracking_no) continue; // no parcel code → skip (fail-safe, never post garbage)
      const st = parseStore(cell(map.store));
      if (!st.hasCode && !sawStoreCodeWarning) { sawStoreCodeWarning = true; console.warn(`${TAG} store column has no 6-digit code — buyer-username link may not fire (stored the name).`); }
      out.push({
        tracking_no,
        cm_order_no: parseCm(cell(map.cm)),
        recipient_name: cell(map.name) || null,
        store_id: st.store,
        order_amount: parseAmount(cell(map.amount)),
        // buyer_username is NOT scraped here — the export reader is the sole handle source.
        // These rows always take pcUpsertTracking's no-handle path (never touch buyer_username).
      });
    }
    return out;
  }

  // Best-effort in-page "next page" control (client-side pagination). If pagination
  // instead navigates (full reload), this script simply re-runs on the next page and
  // scrapes it — so either mechanism covers every page. Returns the clickable el or null.
  function findNextControl() {
    const candidates = Array.from(document.querySelectorAll(
      "a, button, li.next > a, .pagination .next:not(.disabled) a, [aria-label='Next'], [aria-label='下一頁']",
    ));
    for (const el of candidates) {
      const label = norm(el.textContent) + " " + norm(el.getAttribute("aria-label"));
      const disabled = el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled") || el.closest(".disabled, [aria-disabled='true']") || el.hasAttribute("disabled");
      if (!disabled && /下一頁|下一頁|下頁|next|›|»/i.test(label)) return el;
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const firstCellSig = () => { const t = findOrderTable(); const tr = t && t.querySelector("tbody tr"); return tr ? norm(tr.textContent).slice(0, 80) : ""; };

  function postRows(rows) {
    if (!rows.length) return;
    try {
      chrome.runtime.sendMessage({ type: "PC_ORDER_ROWS", rows }, (resp) => {
        if (chrome.runtime.lastError) { console.warn(`${TAG} background not reachable:`, chrome.runtime.lastError.message); return; }
        console.log(`${TAG} upsert result:`, JSON.stringify(resp || {}));
      });
    } catch (e) { console.warn(`${TAG} sendMessage failed:`, e && e.message); }
  }

  async function run() {
    if (!findOrderTable()) { console.log(`${TAG} no order table on this page — nothing to scrape (safe).`); return; }
    const seenCodes = new Set();
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = scrapeCurrentPage().filter((r) => !seenCodes.has(r.tracking_no));
      rows.forEach((r) => seenCodes.add(r.tracking_no));
      total += rows.length;
      postRows(rows);
      const next = findNextControl();
      if (!next) break;
      const before = firstCellSig();
      await sleep(PAGE_DELAY_MS);
      next.click();
      // wait for the table's first row to change (client-side paginate); if a full
      // navigation happens instead, this instance ends and the next load re-scrapes.
      let waited = 0;
      while (waited < 8000 && firstCellSig() === before) { await sleep(200); waited += 200; }
      if (firstCellSig() === before) { console.log(`${TAG} next page didn't change the table — stopping.`); break; }
    }
    console.log(`${TAG} done — scraped ${total} order row(s) with a parcel code across ${seenCodes.size ? "≥1" : 0} page(s).`);
  }

  run().catch((e) => console.warn(`${TAG} scraper threw (safe):`, e && e.message));
})();
