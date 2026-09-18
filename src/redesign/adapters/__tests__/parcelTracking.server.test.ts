// server/parcelTracking.js core — parse + classify SHOPMORE /PackageDetail results.
// server.js has no vitest harness, so this exercises the pure core directly. The
// fixtures are the REAL searchResults shapes captured from tracking.shopmore.com.tw
// (mirrored uncommitted in vendor/shopmore-sample.txt) — embedded here so the test
// is self-contained (an uncommitted file would break CI). The network runner + the
// admin route are built later; this pins the parse/status/chaseable contract.
import { describe, it, expect, vi } from "vitest";
import {
  parseSearchResults, mapStatus, resultToUpdate, isChaseable,
  batch, isExpiredCaptcha, cleanCaptcha, buildQueryBody, pollBatch,
  MAX_BATCH,
} from "../../../../server/parcelTracking.js";

// ── Real fixtures (full `var searchResults=[…];` HTML the poller receives) ──────
// (1) IN-TRANSIT, C2C, recDate empty.
const HTML_IN_TRANSIT = `<html><script>var searchResults = [{"id":null,"paymentNo":"F70334584020","recStore":"朝陽","recStoreAddr":"新竹縣竹東鎮朝陽路70號","recDate":"","orderAmount":60,"status":1,"statusMessage":"包裹進行配送中","shipStatusDetails":[{"notificationName":"包裹進行配送中","ppsDatetime":"2026/09/17 20:58"},{"notificationName":"包裹等待配送中","ppsDatetime":"2026/09/17 16:42"},{"notificationName":"包裹已送達物流中心，將配至取件門市","ppsDatetime":"2026/09/17 12:38"},{"notificationName":"貨運已取件，包裹將送往物流中心","ppsDatetime":"2026/09/16 21:01"},{"notificationName":"寄件門市已收件","ppsDatetime":"2026/09/16 21:01"},{"notificationName":"訂單已成立，尚未至門市寄件","ppsDatetime":"2026/09/16 10:42"}],"shipType":"C2C","specialType":null}];</script></html>`;

// (2) PICKED UP, C2C, recDate populated. NO 退 events → real buyer pickup.
const HTML_PICKED_UP = `var searchResults = [{"paymentNo":"F48584681198","recStore":"中壢華強","recDate":"2026/09/18","orderAmount":350,"status":1,"statusMessage":"已完成包裹取件","shipStatusDetails":[{"notificationName":"已完成包裹取件","ppsDatetime":"2026/09/11 19:27"},{"notificationName":"包裹配達取件門市","ppsDatetime":"2026/09/10 23:07"},{"notificationName":"包裹等待配送中","ppsDatetime":"2026/09/10 15:54"},{"notificationName":"包裹已送達物流中心，將配至取件門市","ppsDatetime":"2026/09/10 12:31"},{"notificationName":"貨運已取件，包裹將送往物流中心","ppsDatetime":"2026/09/09 21:01"},{"notificationName":"寄件門市已收件","ppsDatetime":"2026/09/09 21:01"},{"notificationName":"訂單已成立，尚未至門市寄件","ppsDatetime":"2026/09/09 20:58"}],"shipType":"C2C","specialType":null}];`;

// (3) RETURNED, C2C — 已完成包裹取件 at [0] (seller collected the RETURN) + 退 events
//     lower in the ladder. THE BUG-CATCH: naive [0] read would say picked_up.
const HTML_RETURNED = `var searchResults = [{"paymentNo":"E79829464311","recStore":"退貨門市","recDate":"2026/09/09","orderAmount":420,"status":1,"statusMessage":"已完成包裹取件","shipStatusDetails":[{"notificationName":"已完成包裹取件"},{"notificationName":"包裹配達指定退貨門市"},{"notificationName":"包裹等待配送中"},{"notificationName":"包裹已送達物流中心，將配至指定退貨門市"},{"notificationName":"包裹退往物流中心"},{"notificationName":"包裹今日23:59後將退回物流中心"},{"notificationName":"包裹配達取件門市"},{"notificationName":"包裹等待配送中"},{"notificationName":"包裹已送達物流中心，將配至取件門市"},{"notificationName":"貨運已取件，包裹將送往物流中心"},{"notificationName":"寄件門市已收件"},{"notificationName":"訂單已成立，尚未至門市寄件"}],"shipType":"C2C","specialType":null}];`;

// (4) AT-STORE with the last-chance warning (將退回物流) but NO actual-return marker →
//     at_store + returning_soon (must NOT be classified returned).
const HTML_AT_STORE_WARN = `var searchResults = [{"paymentNo":"F11122233344","recStore":"中壢華強","recDate":"2026/09/20","orderAmount":200,"status":1,"statusMessage":"包裹配達取件門市","shipStatusDetails":[{"notificationName":"包裹今日23:59後將退回物流中心"},{"notificationName":"包裹配達取件門市"},{"notificationName":"包裹等待配送中"},{"notificationName":"貨運已取件，包裹將送往物流中心"},{"notificationName":"寄件門市已收件"},{"notificationName":"訂單已成立，尚未至門市寄件"}],"shipType":"C2C","specialType":null}];`;

// (5) HOME DELIVERY — C2C but specialType present → chaseable=false.
const HTML_HOME_DELIVERY = `var searchResults = [{"paymentNo":"F55566677788","recStore":"","recDate":"","orderAmount":300,"status":1,"statusMessage":"包裹進行配送中","shipStatusDetails":[{"notificationName":"包裹進行配送中"}],"shipType":"C2C","specialType":"4.店到宅服務單"}];`;

const one = (html: string) => parseSearchResults(html)[0];

describe("parseSearchResults", () => {
  it("extracts + shape-guards the real in-transit object", () => {
    const rows = parseSearchResults(HTML_IN_TRANSIT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentNo: "F70334584020", status: 1, recDate: "", shipType: "C2C", specialType: null, orderAmount: 60 });
    expect(rows[0].shipStatusDetails.length).toBe(6);
  });
  it("also lifts shipType + specialType (home delivery)", () => {
    expect(one(HTML_HOME_DELIVERY)).toMatchObject({ shipType: "C2C", specialType: "4.店到宅服務單" });
  });
  it("no match / garbage / non-array → [] (never throws)", () => {
    expect(parseSearchResults("<html>nothing</html>")).toEqual([]);
    expect(parseSearchResults("var searchResults = [not json];")).toEqual([]);
    expect(parseSearchResults("")).toEqual([]);
  });
});

describe("mapStatus — locked from the 3 real samples", () => {
  it("(a) in_transit F70334584020 → in_transit", () => {
    const r = one(HTML_IN_TRANSIT);
    expect(mapStatus(r.statusMessage, r.shipStatusDetails)).toMatchObject({ status: "in_transit", terminal: false, known: true, returning_soon: false });
  });
  it("(b) clean pickup F48584681198 (已完成包裹取件, NO 退) → picked_up terminal", () => {
    const r = one(HTML_PICKED_UP);
    expect(mapStatus(r.statusMessage, r.shipStatusDetails)).toMatchObject({ status: "picked_up", terminal: true, known: true });
  });
  it("(c) BUG-CATCH: returned E79829464311 (已完成包裹取件 at [0] AND 退 events) → returned terminal, NOT picked_up", () => {
    const r = one(HTML_RETURNED);
    const m = mapStatus(r.statusMessage, r.shipStatusDetails);
    expect(m.status).toBe("returned");
    expect(m.terminal).toBe(true);
    expect(m.returning_soon).toBe(true); // the ladder also carries the 將退回物流 warning
  });
  it("(d) at_store + 將退回物流 warning → at_store + returning_soon (NOT returned)", () => {
    const r = one(HTML_AT_STORE_WARN);
    expect(mapStatus(r.statusMessage, r.shipStatusDetails)).toMatchObject({ status: "at_store", terminal: false, known: true, returning_soon: true });
  });
  it("the in_transit 貨運已取件 step is never misread as picked_up", () => {
    expect(mapStatus("貨運已取件，包裹將送往物流中心", [{ notificationName: "貨運已取件，包裹將送往物流中心" }]).status).toBe("in_transit");
  });
  it("an unmapped newest step → unknown + known:false (so the caller logs it)", () => {
    expect(mapStatus("門市特殊處理中XYZ", [{ notificationName: "門市特殊處理中XYZ" }])).toMatchObject({ status: "unknown", known: false });
  });
});

describe("isChaseable — C2C store pickup only", () => {
  it("C2C + no specialType → chaseable", () => { expect(isChaseable("C2C", null)).toBe(true); expect(isChaseable("C2C", "")).toBe(true); });
  it("home delivery specialType '4.店到宅服務單' → NOT chaseable", () => { expect(isChaseable("C2C", "4.店到宅服務單")).toBe(false); });
  it("C2C→宅配 / return service unit → NOT chaseable", () => {
    expect(isChaseable("C2C", "99.C2C轉宅配(數網自訂)")).toBe(false);
    expect(isChaseable("C2C", "0.退貨便服務單")).toBe(false);
  });
  it("non-C2C ship types → NOT chaseable", () => { expect(isChaseable("C2B", null)).toBe(false); expect(isChaseable("B2C", null)).toBe(false); });
});

describe("resultToUpdate", () => {
  it("in_transit: recDate empty → pickup_deadline null, chaseable, not terminal", () => {
    const u = resultToUpdate(one(HTML_IN_TRANSIT), { now: new Date("2026-09-18T00:00:00Z") });
    expect(u).toMatchObject({ tracking_no: "F70334584020", status: "in_transit", pickup_deadline: null, chaseable: true, terminal: false, ship_type: "C2C", special_type: null });
  });
  it("picked_up: recDate stored raw, terminal", () => {
    const u = resultToUpdate(one(HTML_PICKED_UP), {});
    expect(u).toMatchObject({ status: "picked_up", terminal: true, pickup_deadline: "2026/09/18", chaseable: true });
  });
  it("at_store: arrived_at set to now (once), returning_soon carried", () => {
    const now = new Date("2026-09-19T02:00:00Z");
    const u = resultToUpdate(one(HTML_AT_STORE_WARN), { now });
    expect(u).toMatchObject({ status: "at_store", returning_soon: true, pickup_deadline: "2026/09/20", chaseable: true });
    expect(u.arrived_at).toBe(now.toISOString());
    // set-once: a prior arrived_at is preserved
    expect(resultToUpdate(one(HTML_AT_STORE_WARN), { now, prevArrivedAt: "2026-09-18T00:00:00.000Z" }).arrived_at).toBe("2026-09-18T00:00:00.000Z");
  });
  it("home delivery → chaseable false even though C2C + in_transit", () => {
    expect(resultToUpdate(one(HTML_HOME_DELIVERY), {})).toMatchObject({ chaseable: false, special_type: "4.店到宅服務單" });
  });
  it("status 0 or 2 → not_found", () => {
    expect(resultToUpdate({ paymentNo: "FX", status: 0 }, {}).status).toBe("not_found");
    expect(resultToUpdate({ paymentNo: "FX", status: 2 }, {}).status).toBe("not_found");
  });
});

describe("batch / captcha helpers / query body", () => {
  it("batch groups ≤6 (MAX_BATCH) codes", () => {
    expect(MAX_BATCH).toBe(6);
    const b = batch(["1", "2", "3", "4", "5", "6", "7"], 6);
    expect(b).toEqual([["1", "2", "3", "4", "5", "6"], ["7"]]);
    expect(batch([], 6)).toEqual([]);
  });
  it("isExpiredCaptcha detects ?handler= redirects", () => {
    expect(isExpiredCaptcha("https://tracking.shopmore.com.tw/PackageDetail?handler=expired")).toBe(true);
    expect(isExpiredCaptcha("https://tracking.shopmore.com.tw/PackageDetail?handler=")).toBe(true);
    expect(isExpiredCaptcha("https://tracking.shopmore.com.tw/PackageDetail")).toBe(false);
  });
  it("cleanCaptcha keeps 4 digits", () => {
    expect(cleanCaptcha(" a1b2 c3d4x ")).toBe("1234");
    expect(cleanCaptcha("12")).toBe("12");
  });
  it("buildQueryBody repeats PaymentNo[] + CaptchaId + Captcha", () => {
    const body = buildQueryBody({ paymentNos: ["F1", "F2"], captchaId: "GID", captcha: "1234" });
    expect(body.getAll("PaymentNo[]")).toEqual(["F1", "F2"]);
    expect(body.get("CaptchaId")).toBe("GID");
    expect(body.get("Captcha")).toBe("1234");
  });
});

describe("pollBatch (injected deps — no network/OCR)", () => {
  const goodDeps = (html: string, onUnknownStatus?: (m: string) => void) => ({
    getCaptcha: vi.fn(async () => ({ captchaId: "GID", image: "base64png" })),
    solveCaptcha: vi.fn(async () => "1234"),
    submitQuery: vi.fn(async () => ({ finalUrl: "https://tracking.shopmore.com.tw/PackageDetail", html })),
    onUnknownStatus,
  });

  it("happy path → parsed updates, attempts=1", async () => {
    const r = await pollBatch(["F70334584020"], goodDeps(HTML_IN_TRANSIT));
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.updates[0]).toMatchObject({ tracking_no: "F70334584020", status: "in_transit" });
  });

  it("expired captcha → refetch + retry, then succeed (attempts=2)", async () => {
    let n = 0;
    const deps = {
      getCaptcha: vi.fn(async () => ({ captchaId: "GID", image: "img" })),
      solveCaptcha: vi.fn(async () => "1234"),
      submitQuery: vi.fn(async () => (++n === 1
        ? { finalUrl: "https://tracking.shopmore.com.tw/PackageDetail?handler=expired", html: "" }
        : { finalUrl: "https://tracking.shopmore.com.tw/PackageDetail", html: HTML_PICKED_UP })),
    };
    const r = await pollBatch(["F48584681198"], deps);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(deps.getCaptcha).toHaveBeenCalledTimes(2); // refetched a fresh captcha
    expect(r.updates[0].status).toBe("picked_up");
  });

  it("captcha keeps failing → ok:false after cap 3, no updates", async () => {
    const deps = {
      getCaptcha: vi.fn(async () => ({ captchaId: "GID", image: "img" })),
      solveCaptcha: vi.fn(async () => "0000"),
      submitQuery: vi.fn(async () => ({ finalUrl: "https://tracking.shopmore.com.tw/PackageDetail?handler=expired", html: "" })),
    };
    const r = await pollBatch(["F1"], deps);
    expect(r).toMatchObject({ ok: false, attempts: 3, error: "captcha_failed" });
    expect(r.updates).toEqual([]);
  });

  it("logs every unknown statusMessage (so we learn new strings from prod)", async () => {
    const seen: string[] = [];
    const unknownHtml = `var searchResults = [{"paymentNo":"FZ","status":1,"statusMessage":"門市特殊處理中XYZ","shipStatusDetails":[{"notificationName":"門市特殊處理中XYZ"}],"shipType":"C2C","specialType":null}];`;
    const r = await pollBatch(["FZ"], goodDeps(unknownHtml, (m) => seen.push(m)));
    expect(r.ok).toBe(true);
    expect(r.updates[0].status).toBe("unknown");
    expect(seen).toEqual(["門市特殊處理中XYZ"]);
  });
});
