// INVOICING — the rules without a screen (adapters/invoicing.ts):
//   • the rows are the Orders buyer cards of the session (one per buyer, every day of a multi-day session
//     together) and the message is the Send to TikTok message — compared with the Orders code itself;
//   • the order of "Send next", the tags, "New item" after a send, the filters;
//   • what is kept for a buyer is a number, a short code and a status — never a name or a username.
import { describe, it, expect, beforeEach } from "vitest";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { buyerReceipts } from "../useReadData";
import { buildSendMessage, currentSessionDate, initialSendLines, messageTotal } from "../tiktokSend";
import { chaseTarget } from "../parcelTracking";
import {
  buyerKeyOf, feeInput, feeText, inFilter, invoiceCounts, invoiceMessage, invoiceRows, invoiceSessionKey, invoicingVisible, linesHashOf, loadPending,
  copyFailedRow, normalizeInvoiceFormat, savePending, sendQueue, sendRowsToMap, sendTarget, sentTime, shortHash, stateOf, tagOf, type SavedStatus,
} from "../invoicing";

const LABELS = { hi: "Hi {name}!", order: "Your order ({date}):", total: "Total: {total}", shipping: "Shipping fee: {fee}" };
const row = (n: number, handle: string, product: string, price: number, at: string, platform = "TikTok", qty = 1): LiveSessionRow =>
  ({ buyer_number: n, handle, customer_name: handle.replace("@", ""), platform, product, price, qty, created_at: at, session_date: at.slice(0, 10) });

// A 3-day session: buyer #1 orders on day 1 and day 3, #2 on day 2, #3 (Facebook) on day 1, #4 on day 3.
const THREE_DAYS: LiveSessionRow[] = [
  row(1, "@ana", "A1 dress", 350, "2026-11-24T05:00:00.000Z"),
  row(3, "Bea Cruz", "FB top", 200, "2026-11-24T05:10:00.000Z", "Facebook"),
  row(2, "@ben.t", "B2 top", 280, "2026-11-25T05:00:00.000Z", "TikTok", 3),
  row(1, "@ana", "C3 bag", 120, "2026-11-26T05:00:00.000Z"),
  row(4, "7234567890123456789", "D4 cap", 90, "2026-11-26T05:05:00.000Z"),
  row(1, "@ana", "FREE", 0, "2026-11-26T05:06:00.000Z"),
];
const buyersOf = (rows: LiveSessionRow[]): Buyer[] => rebuildSessionFromRows(rows).buyers;

describe("who can open Invoicing", () => {
  it("the switch, an admin or the preview list — one of them is enough; none = closed", () => {
    expect(invoicingVisible({ isAdmin: false, previewKey: false, switchOn: false })).toBe(false);
    expect(invoicingVisible({ isAdmin: false, previewKey: false, switchOn: true })).toBe(true);
    expect(invoicingVisible({ isAdmin: true, previewKey: false, switchOn: false })).toBe(true);
    expect(invoicingVisible({ isAdmin: false, previewKey: true, switchOn: false })).toBe(true);
  });
});

describe("the rows are the Orders buyer cards", () => {
  const buyers = buyersOf(THREE_DAYS);
  const rows = invoiceRows(buyers, "tiktok", "");
  it("one row per TikTok buyer, in buyer-number order, every day of the session in the same row", () => {
    expect(rows.map((r) => r.num)).toEqual([1, 2, 4]);
    expect(rows[0].receipt.lines.map((l) => l.item)).toEqual(["A1 dress", "C3 bag", "FREE"]);   // day 1 + day 3
    expect(rows[0].orderNums).toHaveLength(3);
  });
  it("each row's card IS the Orders buyer card of that number (same object shape, same lines, same total)", () => {
    for (const r of rows) {
      const card = buyerReceipts(buyers, r.num).find((c) => c.handle === r.receipt.handle)!;
      expect(r.receipt).toEqual(card);
      expect(r.lines).toEqual(initialSendLines(card.lines));
      expect(r.total).toBe(messageTotal(initialSendLines(card.lines), null, ""));
      expect(r.total).toBe(card.total);                       // no fee → the card's total
    }
  });
  it("the total of a row = its lines + the default shipping fee", () => {
    const withFee = invoiceRows(buyers, "tiktok", "38");
    expect(withFee.map((r) => r.total)).toEqual(rows.map((r) => r.total + 38));
    expect(invoiceRows(buyers, "tiktok", "0").map((r) => r.total)).toEqual(rows.map((r) => r.total));
  });
  it("Facebook buyers are not in the TikTok list (and the other way round)", () => {
    expect(rows.some((r) => r.receipt.platform !== "TikTok")).toBe(false);
    expect(invoiceRows(buyers, "facebook", "").map((r) => r.num)).toEqual([3]);
    expect(invoiceRows(buyers, "shopee", "")).toEqual([]);
  });
  it("two buyers with the same number (two phones) → two rows with different ids, each its own card", () => {
    const two = buyersOf([row(5, "@one", "X", 10, "2026-11-26T05:00:00.000Z"), row(5, "@two", "Y", 20, "2026-11-26T05:01:00.000Z")]);
    const r = invoiceRows(two, "tiktok", "");
    expect(r.map((x) => x.receipt.handle)).toEqual(["@one", "@two"]);
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
    expect(r.map((x) => x.receipt)).toEqual(buyerReceipts(two, 5));
  });
  it("a TikTok buyer and a Facebook buyer with the SAME number: each list has only its own buyer", () => {
    const mixed = buyersOf([row(6, "@tt.buyer", "X", 10, "2026-11-26T05:00:00.000Z"), row(6, "Fb Buyer", "Y", 20, "2026-11-26T05:01:00.000Z", "Facebook")]);
    expect(buyerReceipts(mixed, 6)).toHaveLength(2);                       // the Orders screen shows its chooser for #6
    expect(invoiceRows(mixed, "tiktok", "").map((x) => x.receipt.handle)).toEqual(["@tt.buyer"]);
    expect(invoiceRows(mixed, "facebook", "").map((x) => x.receipt.handle)).toEqual(["Fb Buyer"]);
    expect(invoiceRows(mixed, "facebook", "")[0].orderNums).toHaveLength(1);
    expect(invoiceRows(mixed, "facebook", "")[0].receipt.lines.map((l) => l.item)).toEqual(["Y"]);
  });
  it("no buyers / a broken list → no rows", () => {
    expect(invoiceRows([], "tiktok", "")).toEqual([]);
    expect(invoiceRows(null as unknown as Buyer[], "tiktok", "")).toEqual([]);
  });
});

describe("the message is the Send to TikTok message", () => {
  const buyers = buyersOf(THREE_DAYS);
  for (const [fee, note] of [["", ""], ["38", "GCash 0917 000 0000"], ["0", "Pay within 24 hours"]] as const) {
    it(`fee "${fee}", note "${note}": the same text Send to TikTok builds for that buyer card`, () => {
      for (const r of invoiceRows(buyers, "tiktok", fee)) {
        const card = buyerReceipts(buyers, r.num).find((c) => c.handle === r.receipt.handle)!;
        const lines = initialSendLines(card.lines);
        const date = currentSessionDate("2026-11-24T04:00:00.000Z", 3, r.orderNums, "2026-11-26");
        const expected = buildSendMessage({ name: card.name, date, lines, total: messageTotal(lines, null, fee), cur: "₱", note, labels: LABELS, shippingFee: fee });
        expect(invoiceMessage(r, { cur: "₱", note, fee, date, labels: LABELS })).toBe(expected);
      }
    });
  }
  it("a multi-day session's message carries the session's date range", () => {
    const r = invoiceRows(buyers, "tiktok", "")[0];
    const date = currentSessionDate("2026-11-24T04:00:00.000Z", 3, r.orderNums, "2026-11-26");
    expect(date).toBe("11/24 → 11/26");
    expect(invoiceMessage(r, { cur: "₱", note: "", fee: "", date, labels: LABELS })).toContain("Your order (11/24 → 11/26):");
  });
  it("a number-only TikTok id has no profile link (Send to TikTok's own rule): copy only", () => {
    const r = invoiceRows(buyers, "tiktok", "").find((x) => x.num === 4)!;
    expect(chaseTarget(r.receipt.handle).kind).toBe("copy");
    expect(chaseTarget("@ana")).toEqual({ kind: "open", handle: "ana", url: "https://www.tiktok.com/@ana" });
  });
});

describe("status, tags and the order of Send next", () => {
  const buyers = buyersOf(THREE_DAYS);
  const rows = invoiceRows(buyers, "tiktok", "");
  const [a, b, c] = rows;
  const sent = (r: typeof a, hash = r.hash): SavedStatus => ({ status: "sent", sentAt: "2026-11-26T01:12:00.000Z", hash });
  it("nothing saved → all Not sent, the first is Next", () => {
    const saved = new Map<string, SavedStatus>();
    expect(sendQueue(rows, saved, null).map((r) => r.num)).toEqual([1, 2, 4]);
    expect(rows.map((r) => tagOf(r, saved, null, a.id))).toEqual(["next", "not_sent", "not_sent"]);
    expect(invoiceCounts(rows, saved)).toEqual({ all: 3, active: 3, sent: 0, notSent: 3, cancelled: 0 });
  });
  it("the five tags (+ the buyer being sent right now)", () => {
    const saved = new Map<string, SavedStatus>([[a.id, sent(a)], [c.id, { status: "skipped", sentAt: null, hash: c.hash }]]);
    expect(tagOf(a, saved, null, b.id)).toBe("sent");
    expect(tagOf(b, saved, null, b.id)).toBe("next");
    expect(tagOf(b, saved, null, null)).toBe("not_sent");
    expect(tagOf(c, saved, null, b.id)).toBe("skipped");
    expect(tagOf(a, new Map([[a.id, sent(a, "old")]]), null, null)).toBe("new_item");
    expect(tagOf(b, saved, b.id, null)).toBe("sending");
  });
  it("Send next skips Sent and Can't message, and leaves out the buyer being sent", () => {
    const saved = new Map<string, SavedStatus>([[a.id, sent(a)], [c.id, { status: "skipped", sentAt: null, hash: c.hash }]]);
    expect(sendQueue(rows, saved, null).map((r) => r.num)).toEqual([2]);
    expect(sendQueue(rows, saved, b.id)).toEqual([]);
  });
  it("New item after sent: a new order line or a changed price puts the buyer back in the queue", () => {
    const saved = new Map<string, SavedStatus>(rows.map((r) => [r.id, sent(r)]));
    expect(sendQueue(rows, saved, null)).toEqual([]);
    const more = invoiceRows(buyersOf([...THREE_DAYS, row(2, "@ben.t", "E5 belt", 60, "2026-11-26T06:00:00.000Z")]), "tiktok", "");
    expect(more.map((r) => stateOf(r, saved.get(r.id)))).toEqual(["sent", "new_item", "sent"]);
    expect(sendQueue(more, saved, null).map((r) => r.num)).toEqual([2]);
    const repriced = invoiceRows(buyersOf(THREE_DAYS.map((x) => (x.product === "D4 cap" ? { ...x, price: 95 } : x))), "tiktok", "");
    expect(repriced.map((r) => stateOf(r, saved.get(r.id)))).toEqual(["sent", "sent", "new_item"]);
  });
  it("changing the default shipping fee does NOT turn sent buyers into New item", () => {
    const saved = new Map<string, SavedStatus>(rows.map((r) => [r.id, sent(r)]));
    const withFee = invoiceRows(buyers, "tiktok", "60");
    expect(withFee.map((r) => r.hash)).toEqual(rows.map((r) => r.hash));
    expect(withFee.every((r) => stateOf(r, saved.get(r.id)) === "sent")).toBe(true);
  });
  it("filters: Not sent = everything that is not Sent (New item and Can't message too)", () => {
    expect(inFilter("sent", "sent")).toBe(true);
    for (const s of ["not_sent", "new_item", "skipped"] as const) { expect(inFilter(s, "not_sent")).toBe(true); expect(inFilter(s, "sent")).toBe(false); expect(inFilter(s, "all")).toBe(true); }
    expect(inFilter("sent", "not_sent")).toBe(false);
  });
  it("database rows → the saved map (unknown status words are ignored)", () => {
    const m = sendRowsToMap([
      { buyer_number: 1, buyer_key: "abc", status: "sent", sent_at: "2026-11-26T01:12:00Z", lines_hash: "h1" },
      { buyer_number: 2, buyer_key: "", status: "skipped", sent_at: null, lines_hash: "h2" },
      { buyer_number: 3, buyer_key: "x", status: "weird", sent_at: null, lines_hash: "" },
    ]);
    expect([...m.keys()]).toEqual(["1:abc", "2:"]);
    expect(m.get("1:abc")).toEqual({ status: "sent", sentAt: "2026-11-26T01:12:00Z", hash: "h1" });
  });
});

describe("what is kept for a buyer has no name in it", () => {
  it("the buyer code and the lines code are short lower-case letters/digits (what the table accepts)", () => {
    for (const h of ["@ana", "ana", "ANA", "7234567890123456789", "", "@a.very_long.username.123", "名前"]) {
      expect(buyerKeyOf(h)).toMatch(/^[0-9a-z]{1,24}$/);
      expect(buyerKeyOf(h)).not.toContain(h.replace("@", "").toLowerCase() || "@");
    }
    expect(buyerKeyOf("@Ana")).toBe(buyerKeyOf("ana"));                    // "@" and capitals do not matter
    expect(buyerKeyOf("@ana")).not.toBe(buyerKeyOf("@anb"));
    const r = invoiceRows(buyersOf(THREE_DAYS), "tiktok", "")[0];
    expect(linesHashOf(r.receipt)).toMatch(/^[0-9a-z]{1,24}$/);
    expect(shortHash("x")).toBe(shortHash("x"));
  });
  it("the row id is the number + that code", () => {
    const r = invoiceRows(buyersOf(THREE_DAYS), "tiktok", "")[0];
    expect(r.id).toBe(`1:${buyerKeyOf("@ana")}`);
    expect(r.id).not.toContain("ana");
  });
});

describe("session, the buyer being sent, the format", () => {
  beforeEach(() => localStorage.clear());
  it("the status belongs to the session id; with no session yet, to the Taipei day", () => {
    expect(invoiceSessionKey("6b0f…id", "2026-11-26")).toBe("6b0f…id");
    expect(invoiceSessionKey(null, "2026-11-26")).toBe("day:2026-11-26");
    expect(invoiceSessionKey("  ", "2026-11-26")).toBe("day:2026-11-26");
    expect(invoiceSessionKey("x".repeat(200), "d").length).toBe(80);
  });
  it("the buyer being sent is remembered on this phone, for that seller + session + platform only", () => {
    savePending("u1", "S1", "tiktok", "2:abc");
    expect(loadPending("u1", "S1", "tiktok")).toBe("2:abc");
    expect(loadPending("u1", "S2", "tiktok")).toBeNull();                  // a new session starts clean
    expect(loadPending("u2", "S1", "tiktok")).toBeNull();
    expect(loadPending("u1", "S1", "facebook")).toBeNull();
    savePending("u1", "S1", "tiktok", null);
    expect(loadPending("u1", "S1", "tiktok")).toBeNull();
    localStorage.setItem("sfl_rd_invoice_pending:u1", "{broken");
    expect(loadPending("u1", "S1", "tiktok")).toBeNull();
  });
  it("copy failed (this phone only): that buyer keeps the button and the tag — never a Sent buyer", () => {
    const rows = invoiceRows(buyersOf(THREE_DAYS), "tiktok", "");            // #1 @ana, #2 @ben.t, #4 (number-only id)
    const [r1, r2, r4] = rows;
    const none = new Map<string, SavedStatus>();
    // nothing failed: the button is on the first of the queue
    expect(sendTarget(rows, none, null, null)).toEqual({ row: r1, again: false });
    // #2's copy failed: the button stays on #2 although #1 is before it in buyer-number order
    expect(sendTarget(rows, none, null, r2.id)).toEqual({ row: r2, again: true });
    expect(rows.map((r) => tagOf(r, none, null, r2.id, r2.id))).toEqual(["not_sent", "copy_failed", "not_sent"]);
    // a buyer saved as Sent is never "copy failed" (a refused Send again leaves them Sent)
    const sent = new Map<string, SavedStatus>([[r2.id, { status: "sent", sentAt: null, hash: r2.hash }]]);
    expect(copyFailedRow(rows, sent, r2.id)).toBeNull();
    expect(sendTarget(rows, sent, null, r2.id)).toEqual({ row: r1, again: false });
    expect(tagOf(r2, sent, null, r1.id, r2.id)).toBe("sent");
    // …but Sent with other lines (New item) or Can't message can be
    const stale = new Map<string, SavedStatus>([[r2.id, { status: "sent", sentAt: null, hash: "other" }]]);
    expect(tagOf(r2, stale, null, null, r2.id)).toBe("copy_failed");
    const skipped = new Map<string, SavedStatus>([[r4.id, { status: "skipped", sentAt: null, hash: r4.hash }]]);
    expect(sendTarget(rows, skipped, null, r4.id)).toEqual({ row: r4, again: true });
    // a buyer who is no longer in the list
    expect(sendTarget(rows, none, null, "99:gone")).toEqual({ row: r1, again: false });
    // copy failed wins over "being sent" for the same buyer; the old 4-argument call is unchanged
    expect(tagOf(r1, none, r1.id, null, r1.id)).toBe("copy_failed");
    expect(tagOf(r1, none, r1.id, null)).toBe("sending");
  });
  it("the format row: the note is the receipt note; no fee saved = no shipping line", () => {
    expect(normalizeInvoiceFormat(null)).toEqual({ note: "", fee: "" });
    expect(normalizeInvoiceFormat({ note: "GCash", invoice_shipping_fee: null, opening: "hi" })).toEqual({ note: "GCash", fee: "" });
    expect(normalizeInvoiceFormat({ note: "GCash", invoice_shipping_fee: 38 })).toEqual({ note: "GCash", fee: "38" });
    expect(normalizeInvoiceFormat({ note: "x", invoice_shipping_fee: "0" })).toEqual({ note: "x", fee: "0" });
    expect(normalizeInvoiceFormat({ note: "x", invoice_shipping_fee: -5 })).toEqual({ note: "x", fee: "" });
    expect(normalizeInvoiceFormat({ note: "x" })).toEqual({ note: "x", fee: "" });   // before sql/220: no column
    expect(feeText(null)).toBe(""); expect(feeText(0)).toBe("0"); expect(feeText(38)).toBe("38");
  });
  it("a typed fee: digits only, never above the limit", () => {
    expect(feeInput("3a8", "NT$")).toBe("38");
    expect(feeInput("99999999", "NT$")).toBe("1000000");
  });
  it("the Sent time is shown as h:mm", () => {
    const d = new Date(2026, 10, 26, 9, 5);
    expect(sentTime(d.toISOString())).toBe("9:05");
    expect(sentTime(null)).toBe(""); expect(sentTime("nope")).toBe("");
  });
});
