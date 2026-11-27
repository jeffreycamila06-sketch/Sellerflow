// WAYBILL USERNAME — the TikTok Shop Order list CSV reader (behaviour: real CSV text in, orders out).
import { describe, expect, it } from "vitest";
import { parseOrderCsv, parseCsvRows, detectDelimiter, readCsvFile, orderIdOf, trackingOf } from "../waybillCsv";
import { buildOrderCsv, type FixtureOrder } from "./fixtures/waybillFixture";

const ORDERS: FixtureOrder[] = [
  { orderId: "580000000000004821", tracking: "JT0000000004821", masked: "m******3", items: 2 },
  { orderId: "580000000000004822", tracking: "JT0000000004822", masked: "j*********s" },
  { orderId: "580000000000004823", masked: "a****8" },
];
const ok = (text: string) => {
  const r = parseOrderCsv(text);
  if (!r.ok) throw new Error(`not ok: ${"error" in r ? r.error : ""}`);
  return r.orders;
};

describe("reading the order list", () => {
  it("plain TikTok-shaped CSV: one order per Order ID (an order with 2 items is 2 rows → kept once)", () => {
    expect(ok(buildOrderCsv(ORDERS))).toEqual([
      { orderId: "580000000000004821", tracking: "JT0000000004821", masked: "m******3" },
      { orderId: "580000000000004822", tracking: "JT0000000004822", masked: "j*********s" },
      { orderId: "580000000000004823", tracking: null, masked: "a****8" },
    ]);
  });
  it("a byte-order mark and Windows line ends change nothing", () => {
    expect(ok(buildOrderCsv(ORDERS, { bom: true, crlf: true }))).toEqual(ok(buildOrderCsv(ORDERS)));
  });
  it("quotes, commas and line breaks INSIDE a field (the buyer message) do not shift the columns", () => {
    const text = buildOrderCsv(ORDERS);
    expect(text).toContain('"Please ""wrap"" it, thanks\nsecond line"'); // the fixture really has them
    expect(ok(text).map((o) => o.masked)).toEqual(["m******3", "j*********s", "a****8"]);
  });
  it("the columns in another order (reversed) + extra columns: found by their header names", () => {
    expect(ok(buildOrderCsv(ORDERS, { reorder: true }))).toEqual(ok(buildOrderCsv(ORDERS)));
  });
  it("a description row under the headers is skipped (no order id, no tracking number)", () => {
    expect(ok(buildOrderCsv(ORDERS, { descriptionRow: true }))).toEqual(ok(buildOrderCsv(ORDERS)));
  });
  it("an order id with a tab in front (Excel trick) is read as the plain digits", () => {
    expect(ok(buildOrderCsv(ORDERS, { tabPrefix: true }))[0].orderId).toBe("580000000000004821");
  });
  it("header names: any case, spaces, a byte-order mark on the first one", () => {
    const text = "\uFEFFORDER  id,buyer_username,TRACKING ID\n580000000000000001,x****1,JT1234567890\n";
    expect(ok(text)).toEqual([{ orderId: "580000000000000001", tracking: "JT1234567890", masked: "x****1" }]);
  });
  it("semicolon and tab separated files are read too", () => {
    expect(ok("Order ID;Buyer Username\n580000000000000001;a**b\n")).toEqual([{ orderId: "580000000000000001", tracking: null, masked: "a**b" }]);
    expect(ok("Order ID\tBuyer Username\n580000000000000001\ta**b\n")[0].masked).toBe("a**b");
  });
  it("an order row with an empty username is kept (the waybill then needs a pick)", () => {
    expect(ok("Order ID,Buyer Username\n580000000000000001,\n")).toEqual([{ orderId: "580000000000000001", tracking: null, masked: "" }]);
  });
  it("two rows of one order: the first non-empty username and tracking number win", () => {
    expect(ok("Order ID,Buyer Username,Tracking ID\n580000000000000001,,\n580000000000000001,q***9,JT5555555555\n")).toEqual([{ orderId: "580000000000000001", tracking: "JT5555555555", masked: "q***9" }]);
  });
});

describe("clear errors", () => {
  it("no Buyer Username column → no_username_col", () => {
    expect(parseOrderCsv(buildOrderCsv(ORDERS, { noUsername: true }))).toEqual({ ok: false, error: "no_username_col" });
  });
  it("no Order ID column → no_order_col", () => {
    expect(parseOrderCsv("Tracking ID,Buyer Username\nJT0000000000123,a**b\n")).toEqual({ ok: false, error: "no_order_col" });
  });
  it("empty file / only spaces → empty", () => {
    expect(parseOrderCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parseOrderCsv(" \n \n")).toEqual({ ok: false, error: "empty" });
  });
  it("headers but no order rows → no_rows", () => {
    expect(parseOrderCsv("Order ID,Buyer Username\n")).toEqual({ ok: false, error: "no_rows" });
    expect(parseOrderCsv("Order ID,Buyer Username\nTotal,\n")).toEqual({ ok: false, error: "no_rows" });
  });
  it("a file that is not a CSV order list (a PDF's first bytes) → no_username_col, never a crash", () => {
    expect(parseOrderCsv("%PDF-1.7\n%âãÏÓ\n1 0 obj\n").ok).toBe(false);
  });
  it("readCsvFile reads a real File", async () => {
    const r = await readCsvFile(new File([buildOrderCsv(ORDERS, { bom: true })], "orders.csv", { type: "text/csv" }));
    expect(r.ok && r.orders.length).toBe(3);
  });
});

describe("the small pieces", () => {
  it("parseCsvRows: quotes, doubled quotes, empty fields, no newline at the end", () => {
    expect(parseCsvRows('a,"b,c","d""e",,f')).toEqual([["a", "b,c", 'd"e', "", "f"]]);
    expect(parseCsvRows('x\r\n"multi\nline",y')).toEqual([["x"], ["multi\nline", "y"]]);
  });
  it("detectDelimiter looks at the header line outside quotes", () => {
    expect(detectDelimiter('"a;b",c,d\n1;2;3;4')).toBe(",");
    expect(detectDelimiter("a;b;c\n")).toBe(";");
  });
  it("orderIdOf / trackingOf", () => {
    expect(orderIdOf("\t580000000000004821")).toBe("580000000000004821");
    expect(orderIdOf("'5800 0000 0000 0048 21")).toBe("580000000000004821");
    expect(orderIdOf("5.8E+17")).toBeNull(); // Excel ruined it → no order id (the tracking number is the fallback)
    expect(trackingOf(" jt0000000004821 ")).toBe("JT0000000004821");
    expect(trackingOf("—")).toBeNull();
  });
});
