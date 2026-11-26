// Settings → INVOICING rows (2026-11-26, follow-up): "· N items" under the handle, a visible "✎ View"
// button that opens the SAME row sheet a row tap opens, and "I sent it by hand" in that sheet — only
// while the buyer is "Copy failed" or "Sending…". N = the order lines the sheet shows (one line per
// order; an order with qty x2 is ONE line with "x2", so it counts as 1).
// Database = the in-memory stand-in (invoiceFakeDb.ts), which also answers the past-session reads.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const track = vi.hoisted(() => vi.fn());
vi.mock("../../analytics", async (orig) => ({ ...(await orig<object>()), track }));

import { TProvider, buildT } from "../../i18n";
import Invoicing from "../Invoicing";
import TikTokSendSheet from "../../components/TikTokSendSheet";
import { DB, type FakeOrderRow } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { byHandAllowed, itemCount, invoiceRows, type InvoiceTag } from "../../adapters/invoicing";

const t = buildT("en");
const CUR = "cur-session", P2 = "past-two-day";
const row = (sid: string, at: string, n: number, handle: string, product: string, price: number, qty = 1, platform = "TikTok"): FakeOrderRow =>
  ({ user_id: "u1", session_id: sid, session_date: at.slice(0, 10), created_at: at, buyer_number: n, handle, customer_name: handle.replace("@", "").toUpperCase(), platform, product, price, qty, comment_msg_id: null, auto_code: null });
// the running session is a TWO-day one (Nov 25 → 26): #1 ordered on both days
const CUR_ROWS = [
  row(CUR, "2026-11-25T05:00:00.000Z", 1, "@ana", "A1 dress", 350),
  row(CUR, "2026-11-26T05:00:00.000Z", 1, "@ana", "C3 bag", 120),          // day 2, same buyer → the same row
  row(CUR, "2026-11-25T05:01:00.000Z", 2, "@ben.t", "B2 top", 280, 2),      // ONE order, qty x2
  row(CUR, "2026-11-26T05:02:00.000Z", 3, "@cara", "E5 belt", 60),
  row(CUR, "2026-11-26T05:03:00.000Z", 3, "@cara", "E6 ring", 40),
  row(CUR, "2026-11-26T05:04:00.000Z", 3, "@cara", "E7 pin", 20),
];
const P2_ROWS = [
  row(P2, "2026-11-24T05:00:00.000Z", 1, "@dina", "K1 skirt", 400),
  row(P2, "2026-11-25T06:00:00.000Z", 1, "@dina", "K2 scarf", 150),
  row(P2, "2026-11-25T06:10:00.000Z", 2, "@efren", "K4 shoes", 700),
];
const buyersOf = (rows: FakeOrderRow[]): Buyer[] => rebuildSessionFromRows(rows as unknown as LiveSessionRow[]).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const rowOf = (n: number) => qa("ivc-row").find((r) => r.getAttribute("data-buyer") === String(n))!;
const inRow = (n: number, id: string) => rowOf(n).querySelector(`[data-testid='${id}']`) as HTMLElement;
const tags = () => qa("ivc-row").map((r) => `${r.getAttribute("data-buyer")}:${r.getAttribute("data-tag")}`);
const sends = () => DB.s.sends.map((r) => `${r.buyer_number}:${r.status}`).sort();
const tap = async (el: HTMLElement) => { fireEvent.click(el); await flush(); };
const tapNext = async () => tap((q("ivc-send-next") || q("ivc-done"))!);
const sheetLines = () => qa("tts-line").length + qa("tts-line-added").length;

function Screen() {
  return (
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(CUR_ROWS)} sessionKey={CUR} sessionId={CUR} pastSessions sellerId="u1" todayId="2026-11-26"
          sessionStartedAt="2026-11-25T04:00:00.000Z" sessionWindowDays={2} tapGuardMs={0} />
      </div>
    </TProvider>
  );
}
async function open() { const r = render(<Screen />); await flush(); return r; }
const pickPast = async () => {
  await tap(q("ivc-session-btn")!);
  await tap(qa("ivc-session-item").find((b) => b.getAttribute("data-session") === P2)!);
};

beforeEach(() => {
  DB.reset(); localStorage.clear(); copyText.mockReset(); copyText.mockImplementation(async () => true); track.mockReset();
  DB.s.orders = [...CUR_ROWS, ...P2_ROWS];
});
afterEach(() => cleanup());

describe("item count in the row", () => {
  it("every row: '· N items' after the tag, N = the lines its sheet shows — multi-day buyers too", async () => {
    await open();
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2", "3"]);
    expect(inRow(1, "ivc-row-items").textContent).toBe("· 2 items");     // Nov 25 + Nov 26, one row
    expect(inRow(2, "ivc-row-items").textContent).toBe("· 1 item");      // singular
    expect(inRow(3, "ivc-row-items").textContent).toBe("· 3 items");
    for (const n of [1, 2, 3]) {
      const shown = Number(inRow(n, "ivc-row-items").textContent!.replace(/\D/g, ""));
      await tap(rowOf(n));
      expect(sheetLines()).toBe(shown);
      await tap(q("tts-close")!);
    }
  });
  it("an order with qty x2 is ONE line (the sheet shows it once, with 'x2') → counts as 1", async () => {
    await open();
    await tap(rowOf(2));
    expect(qa("tts-line")).toHaveLength(1);
    expect(q("tts-qty")!.textContent).toBe("x2");
    expect(inRow(2, "ivc-row-items").textContent).toBe("· 1 item");
    expect(itemCount(invoiceRows(buyersOf(CUR_ROWS), "tiktok", "")[1])).toBe(1);
  });
  it("the count sits after the tag, on the tag's line", async () => {
    await open();
    const tag = inRow(1, "ivc-row-tag"), items = inRow(1, "ivc-row-items");
    expect(tag.parentElement).toBe(items.parentElement);
    expect(tag.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("a past (two-day) session: its own counts, and its sheet shows the same lines", async () => {
    await open();
    await pickPast();
    expect(inRow(1, "ivc-row-items").textContent).toBe("· 2 items");     // Nov 24 + Nov 25
    expect(inRow(2, "ivc-row-items").textContent).toBe("· 1 item");
    await tap(inRow(1, "ivc-row-view"));
    expect(sheetLines()).toBe(2);
  });
  it("the words exist in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const tl = buildT(lang);
      expect(tl.rd_ivc_items_1.trim()).not.toBe("");
      expect(tl.rd_ivc_items).toContain("{n}");
      expect(tl.rd_ivc_view.trim()).not.toBe("");
      expect(tl.rd_ivc_by_hand.trim()).not.toBe("");
    }
  });
});

describe("✎ View", () => {
  it("is a real button with the pencil, 'View', the 44px tap area and an accent outline", async () => {
    await open();
    const v = inRow(1, "ivc-row-view") as HTMLButtonElement;
    expect(v.tagName).toBe("BUTTON");
    expect(v.getAttribute("type")).toBe("button");
    expect(v.textContent).toBe("✎View");
    expect(v.querySelector("[aria-hidden='true']")!.textContent).toBe("✎");
    expect(v.getAttribute("aria-label")).toBe("View #1");
    expect(v.className).toContain("sfl-tap44");
    expect(v.style.border).toBe("1.5px solid var(--accent)");
    // under the total, on the right
    const total = inRow(1, "ivc-row-total");
    expect(total.parentElement).toBe(v.parentElement);
    expect(total.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("opens the sheet for THAT buyer — the same sheet a row tap opens", async () => {
    await open();
    await tap(inRow(3, "ivc-row-view"));
    expect(qa("tts-sheet")).toHaveLength(1);
    expect(q("tts-header")!.textContent).toContain("#3");
    expect(q("tts-header")!.textContent).toContain("@cara");
    const viaView = q("tts-sheet")!.innerHTML;
    await tap(q("tts-close")!);
    await tap(rowOf(3));                                               // the whole row still opens it
    expect(qa("tts-sheet")).toHaveLength(1);
    expect(q("tts-sheet")!.innerHTML).toBe(viaView);
  });
  it("the row tap still works on every row, and View changes no status", async () => {
    await open();
    for (const n of [1, 2, 3]) {
      await tap(inRow(n, "ivc-row-handle"));
      expect(q("tts-header")!.textContent).toContain(`#${n}`);
      await tap(q("tts-close")!);
      await tap(inRow(n, "ivc-row-view"));
      expect(q("tts-header")!.textContent).toContain(`#${n}`);
      await tap(q("tts-close")!);
    }
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
    expect(DB.s.sends).toEqual([]);
    expect(copyText).not.toHaveBeenCalled();
  });
  it("the sheet still has Send / Copy only / Can't message, and Send in the sheet works as before", async () => {
    await open();
    await tap(inRow(2, "ivc-row-view"));
    expect(q("tts-copy-open")!.textContent).toBe(t.rd_ivc_send);
    expect(q("tts-copy-only")).not.toBeNull();
    expect(q("tts-skip")!.textContent).toBe(t.rd_ivc_skip);
    await tap(q("tts-copy-open")!);
    expect(sends()).toEqual(["2:sent"]);
  });
});

describe("I sent it by hand", () => {
  const byHand = () => q("tts-by-hand");
  it("only for 'Copy failed' and 'Sending…' (the pure rule)", () => {
    const all: InvoiceTag[] = ["next", "sending", "not_sent", "sent", "new_item", "skipped", "copy_failed"];
    expect(all.filter(byHandAllowed)).toEqual(["sending", "copy_failed"]);
  });
  it("not shown for Next / Not sent", async () => {
    await open();
    await tap(rowOf(1)); expect(byHand()).toBeNull(); await tap(q("tts-close")!);   // Next
    await tap(rowOf(2)); expect(byHand()).toBeNull(); await tap(q("tts-close")!);   // Not sent
  });
  it("Sending…: shown; a tap saves Sent like a normal Sent and closes the sheet", async () => {
    await open();
    await tapNext();                                                   // #1 being sent
    expect(tags()).toEqual(["1:sending", "2:next", "3:not_sent"]);
    await tap(inRow(1, "ivc-row-view"));
    expect(byHand()!.textContent).toBe("I sent it by hand");
    expect(byHand()!.tagName).toBe("BUTTON");
    await tap(byHand()!);
    expect(q("tts-sheet")).toBeNull();
    expect(sends()).toEqual(["1:sent"]);
    expect(DB.s.sends[0].lines_hash).toBeTruthy();                     // the same saved row a normal Sent writes
    expect(tags()).toEqual(["1:sent", "2:next", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toContain("#2");
    // Send next goes on exactly as before: #2 opened, then marked Sent by the next tap
    await tapNext(); await tapNext();
    expect(sends()).toEqual(["1:sent", "2:sent"]);
    expect(track).toHaveBeenCalledWith("invoice_send", { platform: "tiktok", via: "hand" });
  });
  it("Copy failed: shown; a tap saves Sent, clears 'Copy failed' and the big button moves on", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    await tapNext();
    expect(tags()).toEqual(["1:copy_failed", "2:not_sent", "3:not_sent"]);
    await tap(rowOf(1));
    await tap(byHand()!);
    expect(q("tts-sheet")).toBeNull();
    expect(sends()).toEqual(["1:sent"]);
    expect(tags()).toEqual(["1:sent", "2:next", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toContain("Send next · #2");
  });
  it("after 'by hand' on a Copy failed buyer, nothing of 'Copy failed' is left: a later order shows New item, not Copy failed", async () => {
    copyText.mockImplementation(async () => false);
    const Live = ({ rows }: { rows: FakeOrderRow[] }) => (
      <TProvider lang="en"><div data-redesign=""><Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(rows)} sessionKey={CUR} sessionId={CUR} pastSessions sellerId="u1" todayId="2026-11-26" sessionStartedAt="2026-11-25T04:00:00.000Z" sessionWindowDays={2} tapGuardMs={0} /></div></TProvider>
    );
    const r = render(<Live rows={CUR_ROWS} />); await flush();
    await tapNext();                                                   // #1 copy refused
    await tap(rowOf(1)); await tap(byHand()!);
    expect(tags()).toEqual(["1:sent", "2:next", "3:not_sent"]);
    r.rerender(<Live rows={[...CUR_ROWS, row(CUR, "2026-11-26T08:00:00.000Z", 1, "@ana", "N1 new", 99)]} />); await flush();
    expect(rowOf(1).getAttribute("data-tag")).toBe("new_item");
    // New item is back in the queue in buyer-number order → "Send next · #1" (not "Copy again")
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #1 @ana · ₱569");
  });
  it("same as a normal Sent: the same saved row as a Send from the sheet", async () => {
    await open();
    await tap(rowOf(1)); await tap(q("tts-copy-open")!);              // normal Sent of #1 (sheet)
    const normal = { ...DB.s.sends[0] };
    DB.reset(); DB.s.orders = [...CUR_ROWS, ...P2_ROWS]; localStorage.clear(); cleanup();
    await open();
    await tapNext();                                                   // #1 Sending…
    await tap(rowOf(1)); await tap(byHand()!);
    const hand = DB.s.sends[0];
    for (const k of ["session_key", "platform", "buyer_number", "buyer_key", "lines_hash", "status"] as const) expect(hand[k]).toBe(normal[k]);
  });
  it("not shown for Sent, Can't message, New item", async () => {
    await open();
    await tapNext(); await tapNext();                                  // #1 Sent, #2 Sending…
    await tap(rowOf(1)); expect(byHand()).toBeNull(); await tap(q("tts-close")!);   // Sent
    await tap(rowOf(3)); await tap(q("tts-skip")!);                   // #3 Can't message
    expect(rowOf(3).getAttribute("data-tag")).toBe("skipped");
    await tap(rowOf(3)); expect(byHand()).toBeNull(); await tap(q("tts-close")!);
    cleanup();
    DB.s.orders.push(row(CUR, "2026-11-26T07:00:00.000Z", 1, "@ana", "N1 new", 99));
    const extra = [...CUR_ROWS, DB.s.orders[DB.s.orders.length - 1]];
    render(<TProvider lang="en"><div data-redesign=""><Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(extra)} sessionKey={CUR} sessionId={CUR} pastSessions sellerId="u1" todayId="2026-11-26" sessionStartedAt="2026-11-25T04:00:00.000Z" sessionWindowDays={2} tapGuardMs={0} /></div></TProvider>);
    await flush();
    expect(rowOf(1).getAttribute("data-tag")).toBe("new_item");
    await tap(rowOf(1)); expect(byHand()).toBeNull();
  });
  it("the Orders tab's Send to TikTok sheet never shows it (it passes no invoice)", () => {
    const receipt = { num: 1, name: "ANA", handle: "@ana", lines: [{ item: "A1", total: 350 }], count: 1, total: 350, platform: "TikTok" };
    render(<TProvider lang="en"><div data-redesign=""><TikTokSendSheet receipt={receipt} cur="₱" date="11/26" sellerId="u1" onClose={() => {}} /></div></TProvider>);
    expect(q("tts-sheet")).not.toBeNull();
    expect(byHand()).toBeNull();
    expect(q("tts-skip")).toBeNull();
  });
});
