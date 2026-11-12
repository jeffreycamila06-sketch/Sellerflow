// server/fmTracking.js — the PURE FamilyMart (全家) tracking core: what the site's step history
// means for a parcel, what is written to its row, and one session with injected steps.
// The four fixtures are the code sequences of four real parcels (owner, 2026-11-12).
import { describe, it, expect, vi } from "vitest";
import {
  classifyFm, fmRowChange, parseFmAnswer, inquiryItem, detailSteps, stepsFault, runFmSession, fmTime, fmDay,
  isFmTrackingNo, cleanFmCaptcha, newestFirst, safeKeys, safeCode, FM_CODES, FM_PATHS, FM_PARCELS_PER_SESSION, FM_MAX_CAPTCHA_TRIES, FM_ANSWER_KINDS,
} from "../../../../server/fmTracking.js";

type Step = Record<string, unknown>;
// One step. `orderNo` differs from `ec` on the way back.
const step = (ec: string, code: string, date: string, time: string, rtn: string, orderNo = ec, store = "全家取件店"): Step => ({
  ORDER_NO: orderNo, EC_ORDER_NO: ec, ORDER_STATUS: code, ORDER_DATE: date, ORDER_TIME: time,
  STATUS_D: (FM_CODES as Record<string, string>)[code] ?? "新狀態", SEND_STORE_NAME: "全家寄件店", RCV_STORE_NAME: store,
  RCV_STORE_ADDRESS: "某路1號", ORDER_DATE_RTN: rtn, ORDER_DATE_R: "", RCV_STORE_PHONE: "",
});
// codes newest first → steps with falling dates.
const history = (ec: string, codes: string[], rtn: string, at: Record<number, [string, string]> = {}, wayBack: { idx: number[]; orderNo: string; rtn: string } | null = null): Step[] =>
  codes.map((code, i) => {
    const [d, t] = at[i] ?? [`2026/10/${String(28 - i).padStart(2, "0")}`, "10:00"];
    const back = wayBack && wayBack.idx.includes(i);
    return step(ec, code, d, t, back ? wayBack!.rtn : rtn, back ? wayBack!.orderNo : ec, back ? "全家寄件店" : "全家取件店");
  });

const AT_STORE = history("16354220151", ["08", "073", "07", "06", "043", "042", "04", "03", "02", "01"], "2026/11/18", { 0: ["2026/11/11", "04:31"] });
const PICKED = history("16354226527", ["09", "08", "073", "07", "06", "043", "042", "04", "03", "02", "01"], "2026/11/18", { 0: ["2026/11/11", "08:55"], 1: ["2026/11/09", "05:10"] });
// 09,08,073,07,06,043,[31],04,[12],[11],08,073,07,06,043,042,04,03,02,01 — the first 6 and the "04"
// (index 7) are the way back (ORDER_NO 16353664329, RTN 2026/11/13); the rest is the original leg.
const RETURNED = history("16352835793",
  ["09", "08", "073", "07", "06", "043", "31", "04", "12", "11", "08", "073", "07", "06", "043", "042", "04", "03", "02", "01"],
  "2026/11/02", {
    0: ["2026/11/08", "15:02"], 9: ["2026/11/03", "01:21"], 10: ["2026/10/26", "04:40"],   // the three times of the real parcel
    // the way back in between, in order (filled in: only the code order of the real parcel is known)
    1: ["2026/11/08", "09:00"], 2: ["2026/11/07", "20:00"], 3: ["2026/11/07", "10:00"], 4: ["2026/11/06", "20:00"],
    5: ["2026/11/06", "10:00"], 6: ["2026/11/05", "10:00"], 7: ["2026/11/04", "20:00"], 8: ["2026/11/04", "10:00"],
  },
  { idx: [0, 1, 2, 3, 4, 5, 7], orderNo: "16353664329", rtn: "2026/11/13" });
const EXPIRED = history("16351746626", ["40", "01"], "");

describe("classifyFm — the four real parcels", () => {
  it("at the store: newest 08 → at_store, arrived at the 08, deadline = ORDER_DATE_RTN", () => {
    const r = classifyFm(AT_STORE, "16354220151");
    expect(r).toMatchObject({ kind: "at_store", status_message: "貨件配達取件店舖", pickup_deadline: "2026-11-18", rec_store: "全家取件店" });
    expect(r.at).toBe("2026-11-10T20:31:00.000Z"); // 2026/11/11 04:31 Taipei
    expect(r.arrived_at).toBe(r.at);
  });
  it("picked up: a 09 and no return → picked_up at the time of the 09", () => {
    const r = classifyFm(PICKED, "16354226527");
    expect(r).toMatchObject({ kind: "picked_up", status_message: "已完成取件" });
    expect(r.at).toBe("2026-11-11T00:55:00.000Z"); // 2026/11/11 08:55 Taipei
    expect(r.arrived_at).toBe("2026-11-08T21:10:00.000Z");
  });
  it("returned: newest step is 09 已完成取件 (the SELLER collected it) → returned, NOT picked_up", () => {
    const r = classifyFm(RETURNED, "16352835793");
    expect(r.kind).toBe("returned");
    expect(r.status_message).toBe("未取退回物流中心");  // the first 11, not 已完成取件
    expect(r.at).toBe("2026-11-02T17:21:00.000Z");      // the first 11: 2026/11/03 01:21 Taipei
    expect(r.pickup_deadline).toBe("2026-11-02");       // the ORIGINAL leg's deadline, not 2026/11/13
    expect(r.arrived_at).toBe("2026-10-25T20:40:00.000Z"); // the original leg's 08
  });
  it("expired: newest 40 → expired", () => {
    expect(classifyFm(EXPIRED, "16351746626").kind).toBe("expired");
  });
});

describe("classifyFm — the rules one by one", () => {
  const ec = "16300000001";
  it("returned by ANY 11 / 12 / 31, wherever it is", () => {
    for (const code of ["11", "12", "31"]) expect(classifyFm(history(ec, ["04", code, "08", "02", "01"], "2026/11/02"), ec).kind).toBe("returned");
  });
  it("returned by a way-back step alone (ORDER_NO ≠ EC_ORDER_NO), even under a 09", () => {
    const steps = history(ec, ["09", "08", "04", "08", "02", "01"], "2026/11/02", {}, { idx: [0, 1, 2], orderNo: "16399999999", rtn: "2026/11/13" });
    const r = classifyFm(steps, ec);
    expect(r.kind).toBe("returned");
    expect(r.pickup_deadline).toBe("2026-11-02");
  });
  it("in transit for every code 02–073 as the newest step; no deadline", () => {
    for (const code of ["02", "03", "04", "042", "043", "06", "07", "073"]) {
      expect(classifyFm(history(ec, [code, "01"], ""), ec)).toMatchObject({ kind: "in_transit", pickup_deadline: null });
    }
  });
  it("01 only → not_shipped", () => {
    expect(classifyFm(history(ec, ["01"], ""), ec).kind).toBe("not_shipped");
  });
  it("a code we do not know → unknown, with the code — no guess, even when the rest says picked up", () => {
    const r = classifyFm(history(ec, ["09", "55", "08", "02", "01"], "2026/11/02"), ec);
    expect(r).toMatchObject({ kind: "unknown", unknownCode: "55", status_message: "新狀態" });
    expect(classifyFm(history(ec, ["99"], ""), ec).kind).toBe("unknown");
  });
  it("[A] a RETURN wins over a code we do not know: 11 / 12 / 31 or a way-back step → returned", () => {
    for (const code of ["11", "12", "31"]) {
      expect(classifyFm(history(ec, ["55", code, "08", "02", "01"], "2026/11/02"), ec)).toMatchObject({ kind: "returned", pickup_deadline: "2026-11-02" });
    }
    const wayBack = history(ec, ["55", "04", "08", "02", "01"], "2026/11/02", {}, { idx: [0, 1], orderNo: "16399999999", rtn: "2026/11/13" });
    expect(classifyFm(wayBack, ec).kind).toBe("returned");
  });
  it("[B] 40: the row is removed ONLY when every step is 01 or 40; with any other step it is left alone", () => {
    for (const codes of [["40", "01"], ["40"], ["40", "01", "01"], ["01", "40"]]) expect(classifyFm(history(ec, codes, ""), ec).kind).toBe("expired");
    for (const codes of [["40", "02", "01"], ["40", "08", "02", "01"], ["40", "09", "08", "01"], ["40", "55", "01"], ["02", "40", "01"]]) {
      expect(classifyFm(history(ec, codes, "2026/11/02"), ec).kind).toBe("void_unclear");
    }
  });
  it("a 40 together with a return (11 / 12 / 31 or a way-back step) → returned — the row is NOT removed", () => {
    for (const codes of [["40", "11", "08", "01"], ["40", "12", "11", "08", "02", "01"], ["31", "40", "08", "01"]]) {
      expect(classifyFm(history(ec, codes, "2026/11/02"), ec).kind, codes.join(",")).toBe("returned");
    }
    const wayBack = history(ec, ["40", "08", "08", "02", "01"], "2026/11/02", {}, { idx: [1], orderNo: "16399999999", rtn: "2026/11/13" });
    expect(classifyFm(wayBack, ec).kind).toBe("returned");
  });
  it("the steps are put newest first by their own date before anything is decided", () => {
    const upsideDown = [...AT_STORE].reverse();                       // the site sends oldest first
    expect(classifyFm(upsideDown, "16354220151")).toEqual(classifyFm(AT_STORE, "16354220151"));
    expect(classifyFm(upsideDown, "16354220151").kind).toBe("at_store");   // read as given it would be "not shipped" (01 on top)
    const shuffled = [RETURNED[7], RETURNED[0], ...RETURNED.slice(8), ...RETURNED.slice(1, 7)];
    expect(classifyFm(shuffled, "16352835793")).toEqual(classifyFm(RETURNED, "16352835793"));
    // same minute → the site's order is kept; a step without a readable time → nothing is reordered
    const a = step(ec, "08", "2026/11/05", "09:00", "2026/11/12"), b = step(ec, "073", "2026/11/05", "09:00", "");
    expect(newestFirst([a, b])).toEqual([a, b]);
    const noTime = [step(ec, "01", "2026/11/01", "", ""), step(ec, "02", "2026/11/02", "08:00", "")];
    expect(newestFirst(noTime)).toEqual(noTime);
  });
  it("with a return step the original leg is ONLY the steps older than the first return step — also when every step has an ORDER_NO", () => {
    // every step carries the parcel's own ORDER_NO (nothing marks the way back) — the 08 / deadline after the 11 are the seller's
    const list = [
      step(ec, "09", "2026/11/20", "10:00", "2026/11/26", ec, "全家寄件店"), step(ec, "08", "2026/11/19", "10:00", "2026/11/26", ec, "全家寄件店"),
      step(ec, "31", "2026/11/14", "10:00", "2026/11/26", ec, "全家寄件店"), step(ec, "12", "2026/11/12", "10:00", "", ec, ""), step(ec, "11", "2026/11/11", "10:00", "", ec, ""),
      step(ec, "08", "2026/11/03", "10:00", "2026/11/10"), step(ec, "02", "2026/11/01", "10:00", ""), step(ec, "01", "2026/10/31", "10:00", ""),
    ];
    expect(classifyFm(list, ec)).toMatchObject({
      kind: "returned", rec_store: "全家取件店", pickup_deadline: "2026-11-10",
      arrived_at: fmTime("2026/11/03", "10:00"), at: fmTime("2026/11/11", "10:00"),
    });
    // no 08 before the first return step → no store, no arrival, and the deadline is NOT taken from the way back
    expect(classifyFm([...list.slice(0, 5), list[6], list[7]], ec)).toMatchObject({ kind: "returned", rec_store: null, arrived_at: null, pickup_deadline: null });
    // a way-back step OLDER than the first return step is not the original leg either
    const odd = [...list.slice(0, 5), step(ec, "08", "2026/11/05", "10:00", "2026/11/30", "16399999999", "別的店"), ...list.slice(5)];
    expect(classifyFm(odd, ec)).toMatchObject({ kind: "returned", rec_store: "全家取件店", pickup_deadline: "2026-11-10" });
  });
  it("no ORDER_NO on any step + a return: an 08 AFTER the first 11 is not the buyer's store", () => {
    const bare = (code: string, date: string, store: string, rtn = ""): Step => ({ EC_ORDER_NO: ec, ORDER_STATUS: code, ORDER_DATE: date, ORDER_TIME: "10:00", STATUS_D: "", RCV_STORE_NAME: store, ORDER_DATE_RTN: rtn });
    const list = [
      bare("09", "2026/11/20", "全家寄件店"), bare("08", "2026/11/19", "全家寄件店", "2026/11/26"),   // the seller's own store, on the way back
      bare("12", "2026/11/12", ""), bare("11", "2026/11/11", ""),
      bare("08", "2026/11/03", "全家取件店", "2026/11/10"), bare("02", "2026/11/01", ""), bare("01", "2026/10/31", ""),
    ];
    expect(classifyFm(list, ec)).toMatchObject({
      kind: "returned", rec_store: "全家取件店", pickup_deadline: "2026-11-10",
      arrived_at: fmTime("2026/11/03", "10:00"), at: fmTime("2026/11/11", "10:00"),
    });
    // …and with no 08 before the return, the later 08 is still not taken
    expect(classifyFm([list[0], list[1], list[2], list[3], list[5], list[6]], ec)).toMatchObject({ kind: "returned", rec_store: null, arrived_at: null, pickup_deadline: null });
  });
  it("no steps at all → unknown", () => {
    expect(classifyFm([], ec)).toMatchObject({ kind: "unknown", unknownCode: "none" });
    expect(classifyFm(null, ec).kind).toBe("unknown");
  });
  it("a one-digit code is read as two digits (1 → 01)", () => {
    expect(classifyFm([{ ...step(ec, "01", "2026/11/01", "09:00", ""), ORDER_STATUS: 1 }], ec).kind).toBe("not_shipped");
  });
});

describe("fmRowChange — what is written", () => {
  const now = "2026-11-12T03:00:00.000Z";
  const row = { id: "r1", arrived_at: null, rec_store: null };
  it("at_store: status, message, deadline, arrival and store (only when the row has none)", () => {
    const c = fmRowChange(classifyFm(AT_STORE, "16354220151"), row, now);
    expect(c).toEqual({ action: "update", patch: {
      last_polled_at: now, fm_answered_at: now, arrived_at: "2026-11-10T20:31:00.000Z", rec_store: "全家取件店", status: "at_store",
      status_message: "貨件配達取件店舖", terminal: false, pickup_deadline: "2026-11-18",
    } });
    const kept = fmRowChange(classifyFm(AT_STORE, "16354220151"), { id: "r1", arrived_at: "2026-11-01T00:00:00.000Z", rec_store: "上傳的店名" }, now) as { patch: Record<string, unknown> };
    expect(kept.patch).not.toHaveProperty("arrived_at");
    expect(kept.patch).not.toHaveProperty("rec_store");
  });
  it("picked_up / returned: finished, with the real time of the step", () => {
    expect(fmRowChange(classifyFm(PICKED, "16354226527"), row, now)).toMatchObject({ action: "update", patch: { status: "picked_up", terminal: true, picked_up_at: "2026-11-11T00:55:00.000Z" } });
    expect(fmRowChange(classifyFm(RETURNED, "16352835793"), row, now)).toMatchObject({ action: "update", patch: { status: "returned", terminal: true, returned_at: "2026-11-02T17:21:00.000Z", pickup_deadline: "2026-11-02" } });
  });
  it("in transit: the 'drop off before' date from the upload is cleared", () => {
    expect(fmRowChange(classifyFm(history("16300000001", ["03", "02", "01"], ""), "16300000001"), row, now))
      .toEqual({ action: "update", patch: { last_polled_at: now, fm_answered_at: now, status: "in_transit", status_message: "貨件前往物流中心", terminal: false, pickup_deadline: null } });
  });
  it("01 only and not found: nothing but the check time (the status is never lowered)", () => {
    expect(fmRowChange(classifyFm(history("16300000001", ["01"], ""), "16300000001"), row, now)).toEqual({ action: "update", patch: { last_polled_at: now } });
    expect(fmRowChange({ kind: "not_found" }, row, now)).toEqual({ action: "update", patch: { last_polled_at: now } });
  });
  it("[A][B] unknown code and '40 with other steps': the row keeps its status — only the check time", () => {
    expect(fmRowChange({ kind: "unknown", unknownCode: "55", status_message: "新狀態" }, row, now)).toEqual({ action: "update", patch: { last_polled_at: now } });
    expect(fmRowChange({ kind: "void_unclear", status_message: "訂單失效" }, row, now)).toEqual({ action: "update", patch: { last_polled_at: now } });
  });
  it("fm_answered_at is stamped by the four real answers and by nothing else", () => {
    expect([...FM_ANSWER_KINDS].sort()).toEqual(["at_store", "in_transit", "picked_up", "returned"]);
    for (const kind of FM_ANSWER_KINDS) expect((fmRowChange({ kind, status_message: "x", at: now, pickup_deadline: null }, row, now) as { patch: Record<string, unknown> }).patch.fm_answered_at).toBe(now);
    for (const kind of ["not_found", "not_shipped", "unknown", "void_unclear"]) {
      expect((fmRowChange({ kind }, row, now) as { patch: Record<string, unknown> }).patch).toEqual({ last_polled_at: now });
    }
  });
  it("expired (40): the row is removed", () => {
    expect(fmRowChange(classifyFm(EXPIRED, "16351746626"), row, now)).toEqual({ action: "delete" });
  });
  it("never writes tracking_no", () => {
    for (const steps of [AT_STORE, PICKED, RETURNED]) {
      const c = fmRowChange(classifyFm(steps, String(steps[0].EC_ORDER_NO)), row, now) as { patch: Record<string, unknown> };
      expect(c.patch).not.toHaveProperty("tracking_no");
    }
  });
});

describe("log words", () => {
  it("safeKeys: every run of digits in a key name becomes # (a key can be a parcel number or a phone)", () => {
    expect(safeKeys({ "16354220151": 1, "0912345678": 2, ErrorCode: "000", List2: [] })).toBe("#,#,ErrorCode,List#");
    expect(safeKeys({ "tel:0912-345-678": 1 })).toBe("tel#-#-#");
    expect(safeKeys(null)).toBe("object");
    // a code the site sent: 4 characters at most — a longer value could be a parcel number or a phone
    expect([safeCode("000"), safeCode("E0014"), safeCode("16354220151"), safeCode("0912345678"), safeCode("")]).toEqual(["000", "E001", "1635", "0912", "-"]);
    expect(classifyFm([step("16300000001", "16354220151", "2026/11/01", "10:00", "")], "16300000001")).toMatchObject({ kind: "unknown", unknownCode: "1635" });
    expect(() => inquiryItem({ ErrorCode: "0912345678", List: [] }, "16354220151")).toThrow(expect.objectContaining({ code: "inquiry_error", detail: "code=0912" }));
    expect(() => detailSteps({ ErrorCode: "16354220151", List: [] })).toThrow(expect.objectContaining({ code: "detail_error", detail: "code=1635" }));
    expect(() => inquiryItem({ "16354220151": [] }, "16354220151")).toThrow(expect.objectContaining({ detail: expect.stringMatching(/^keys=# code=/) }));
  });
});

describe("answers", () => {
  it("parseFmAnswer: {\"d\":\"<JSON string>\"} is parsed twice", () => {
    expect(parseFmAnswer('{"d":"{\\"Code\\":\\"jIGhjbm2N||Y=\\"}"}')).toEqual({ Code: "jIGhjbm2N||Y=" });
    expect(parseFmAnswer({ d: { success: "1" } })).toEqual({ success: "1" });
    for (const bad of ["<html>blocked</html>", "{}", '{"d":"not json"}', '{"d":null}', '{"Message":"error"}']) {
      expect(() => parseFmAnswer(bad)).toThrow(/bad_answer/);
    }
  });
  it("inquiryItem: found, CNT 0 → not found, any other shape or ErrorCode throws", () => {
    const found = { ErrorCode: "000", ErrorMessage: "成功", List: [{ EC_ORDER_NO: "16351746626", CNT: 1.0, ORDER_NO: "16351746626", ORDERMESSAGE: "訂單失效" }] };
    expect(inquiryItem(found, "16351746626")).toEqual({ found: true, orderNo: "16351746626" });
    const none = { ErrorCode: "000", ErrorMessage: "成功", List: [{ EC_ORDER_NO: "L26A1113SG", CNT: 0.0, ORDER_NO: null, ORDERMESSAGE: null }] };
    expect(inquiryItem(none, "L26A1113SG")).toEqual({ found: false, orderNo: null });
    expect(inquiryItem({ ErrorCode: "000", List: [] }, "16351746626")).toEqual({ found: false, orderNo: null });
    // the answer must be for the parcel we asked — the one item of the list is never taken on trust
    const other = { ErrorCode: "000", List: [{ EC_ORDER_NO: "16399999999", CNT: 1.0, ORDER_NO: "16399999999" }] };
    expect(inquiryItem(other, "16351746626")).toEqual({ found: false, orderNo: null });
    expect(() => inquiryItem({ ErrorCode: "999", ErrorMessage: "x", List: [] }, "1")).toThrow(/inquiry_error/);
    expect(() => inquiryItem({ ErrorCode: "000", List: null }, "1")).toThrow(/inquiry_shape/);
    expect(() => inquiryItem(null, "1")).toThrow(/inquiry_shape/);
  });
  it("detailSteps: a bare list or { List }, anything else throws", () => {
    expect(detailSteps(AT_STORE)).toBe(AT_STORE);
    expect(detailSteps({ ErrorCode: "000", List: PICKED })).toBe(PICKED);
    expect(() => detailSteps({ ErrorCode: "500", List: [] })).toThrow(/detail_error/);
    expect(() => detailSteps({ Message: "x" })).toThrow(/detail_shape/);
  });
  it("stepsFault: an empty list, or a step for another parcel (or for none), cannot be used", () => {
    expect(stepsFault(AT_STORE, "16354220151")).toBeNull();
    expect(stepsFault(RETURNED, "16352835793")).toBeNull(); // the way back carries the same EC_ORDER_NO
    expect(stepsFault([], "16354220151")).toBe("detail_empty");
    expect(stepsFault(AT_STORE, "16354226527")).toBe("detail_mismatch");
    expect(stepsFault([...PICKED, { ...PICKED[0], EC_ORDER_NO: "16399999999" }], "16354226527")).toBe("detail_mismatch");
    expect(stepsFault([{ ...PICKED[0], EC_ORDER_NO: undefined }], "16354226527")).toBe("detail_mismatch");
  });
  it("dates, numbers, captcha text", () => {
    expect(fmTime("2026/11/03", "01:21")).toBe("2026-11-02T17:21:00.000Z");
    expect(fmTime("", "01:21")).toBeNull();
    expect(fmDay("2026/11/2")).toBe("2026-11-02");
    expect(fmDay("")).toBeNull();
    expect(isFmTrackingNo("16351746626")).toBe(true);
    for (const bad of ["L26A1113SG", "1635174662", "163517466261", "", null, "1635174662a"]) expect(isFmTrackingNo(bad)).toBe(false);
    expect(cleanFmCaptcha(" 04 31-80\n")).toBe("043180");
  });
  it("only the InquiryOrders path is confirmed; the guesses are constants", () => {
    expect(FM_PATHS.inquiry).toBe("list.aspx/InquiryOrders");
    expect(Object.keys(FM_PATHS).sort()).toEqual(["checkCode", "codeImage", "detail", "getCode", "index", "inquiry", "list"]);
    expect(FM_PARCELS_PER_SESSION).toBe(5);
    expect(FM_MAX_CAPTCHA_TRIES).toBe(4);
  });
});

describe("runFmSession — one session with injected steps", () => {
  const answers: Record<string, Step[] | null> = { "16354220151": AT_STORE, "16354226527": PICKED, "16352835793": RETURNED, "16351746626": EXPIRED, "16300000009": null };
  const makeDeps = (solves: string[], right = "043180") => {
    const calls: string[] = [];
    let n = 0;
    const deps = {
      openIndex: vi.fn(async () => { calls.push("index"); }),
      getCode: vi.fn(async () => { calls.push("code"); return `C${++n}`; }),
      getImage: vi.fn(async (code: string) => { calls.push(`image:${code}`); return new Uint8Array([1]); }),
      solve: vi.fn(async () => solves.shift() ?? ""),
      checkCode: vi.fn(async (digits: string, code: string) => { calls.push(`check:${digits}:${code}`); return digits === right; }),
      openList: vi.fn(async () => { calls.push("list"); }),
      inquiry: vi.fn(async (no: string) => { calls.push(`inq:${no}`); return { ErrorCode: "000", List: [{ EC_ORDER_NO: no, CNT: answers[no] ? 1 : 0, ORDER_NO: answers[no] ? no : null }] }; }),
      detail: vi.fn(async (no: string, orderNo: string) => { calls.push(`det:${no}:${orderNo}`); return { ErrorCode: "000", List: answers[no] }; }),
    };
    return { deps, calls };
  };

  it("captcha right the first time → every parcel asked in order, each classified", async () => {
    const { deps, calls } = makeDeps(["043180"]);
    const res = await runFmSession(["16354220151", "16300000009", "16352835793", "16351746626"], deps);
    expect(res).toMatchObject({ captchaTries: 1, captchaHits: 1, error: null });
    expect(res.results.map((r: { result: { kind: string } }) => r.result.kind)).toEqual(["at_store", "not_found", "returned", "expired"]);
    expect(calls).toEqual(["index", "code", "image:C1", "check:043180:C1", "list",
      "inq:16354220151", "det:16354220151:16354220151", "inq:16300000009", "inq:16352835793", "det:16352835793:16352835793", "inq:16351746626", "det:16351746626:16351746626"]);
  });
  it("a wrong captcha → a NEW captcha; text that is not 6 digits is not even sent", async () => {
    const { deps, calls } = makeDeps(["999999", "12 34", "043180"]);
    const res = await runFmSession(["16354220151"], deps);
    expect(res).toMatchObject({ captchaTries: 3, captchaHits: 1, error: null });
    expect(calls.filter((c) => c.startsWith("check:"))).toEqual(["check:999999:C1", "check:043180:C3"]); // "1234" was never checked
    expect(deps.getCode).toHaveBeenCalledTimes(3);
    expect(deps.openIndex).toHaveBeenCalledTimes(1); // the same session all along
  });
  it("captcha never right → stops after the limit, no parcel is asked", async () => {
    const { deps } = makeDeps(["111111", "222222", "333333", "444444", "043180"]);
    const res = await runFmSession(["16354220151"], deps);
    expect(res).toMatchObject({ captchaTries: 4, captchaHits: 0, error: "captcha_failed", results: [] });
    expect(deps.inquiry).not.toHaveBeenCalled();
    expect(deps.openList).not.toHaveBeenCalled();
  });
  it("the site stops answering mid-session → what was answered is kept, the error is named", async () => {
    const { deps } = makeDeps(["043180"]);
    let n = 0;
    deps.inquiry.mockImplementation(async (no: string) => (++n > 2 ? { ErrorCode: "999", List: null } : { ErrorCode: "000", List: [{ EC_ORDER_NO: no, CNT: 1, ORDER_NO: no }] }));
    const res = await runFmSession(["16354220151", "16354226527", "16352835793"], deps);
    expect(res.results.map((r: { tracking_no: string }) => r.tracking_no)).toEqual(["16354220151", "16354226527"]);
    expect(res.error).toBe("inquiry_shape");
    expect(res.detail).toContain("code=999");
  });
  it("the site knows the parcel but sends NO step → detail_empty: nothing for that parcel, the session is an error", async () => {
    const { deps } = makeDeps(["043180"]);
    deps.detail.mockImplementation(async (no: string) => ({ ErrorCode: "000", List: no === "16354226527" ? [] : answers[no] }));
    const res = await runFmSession(["16354220151", "16354226527", "16352835793"], deps);
    expect(res.error).toBe("detail_empty");
    expect(res.results.map((r: { tracking_no: string }) => r.tracking_no)).toEqual(["16354220151"]); // not the faulty one, not the ones after it
  });
  it("steps of ANOTHER parcel → detail_mismatch: nothing for that parcel", async () => {
    const { deps } = makeDeps(["043180"]);
    deps.detail.mockImplementation(async () => ({ ErrorCode: "000", List: PICKED })); // every answer is parcel 16354226527
    const res = await runFmSession(["16354220151", "16354226527"], deps);
    expect(res).toMatchObject({ error: "detail_mismatch", results: [] });
  });
  it("a thrown step (network / HTTP) ends the session with its code", async () => {
    const { deps } = makeDeps(["043180"]);
    deps.getCode.mockRejectedValueOnce(Object.assign(new Error("code_http_403"), { code: "code_http_403" }));
    expect(await runFmSession(["16354220151"], deps)).toMatchObject({ error: "code_http_403", results: [] });
  });
});
