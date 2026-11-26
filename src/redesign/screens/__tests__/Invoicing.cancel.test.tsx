// Settings → INVOICING: "Buyer cancelled" + cancel one item (2026-11-26).
//   • a cancelled buyer: tag "Cancelled", left out of Send next and of "X of N sent", under All only;
//     Undo → Sent again (first send time) if they were Sent before the cancel, else Not sent;
//     right after the cancel, "Add <buyer> to Blacklist?" — only when the screen got the Blacklist add.
//   • the × of a line saves the ORDER (its database id) as cancelled: struck through + Undo, out of the
//     message and the total, kept after a reload / on another phone; "New item" ignores it; the last line
//     asks "Cancel the whole buyer?".
//   • the session's orders (rows, buyer numbers) are never written.
// Database = the in-memory stand-in (invoiceFakeDb.ts); its live_session_orders rows carry their own id.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const track = vi.hoisted(() => vi.fn());
vi.mock("../../analytics", async (orig) => ({ ...(await orig<object>()), track }));

import { TProvider, buildT, tpl } from "../../i18n";
import Invoicing from "../Invoicing";
import TikTokSendSheet from "../../components/TikTokSendSheet";
import { DB, type FakeOrderRow } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import type { BlAddResult } from "../../adapters/blacklist";
import { invoiceRows, keptLinesHash, linesHashOf, stateOf } from "../../adapters/invoicing";

const t = buildT("en");
const CUR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let nextId = 500;
const row = (at: string, n: number, handle: string, product: string, price: number, qty = 1): FakeOrderRow =>
  ({ id: nextId++, user_id: "u1", session_id: CUR, session_date: at.slice(0, 10), created_at: at, buyer_number: n, handle, customer_name: handle.replace("@", "").toUpperCase(), platform: "TikTok", product, price, qty, comment_msg_id: null, auto_code: null });
// a TWO-day session: #1 ordered on both days (one row), #2 one order, #3 two orders
const ROWS = (): FakeOrderRow[] => { nextId = 500; return [
  row("2026-11-25T05:00:00.000Z", 1, "@ana", "A1 dress", 350),       // id 500
  row("2026-11-25T05:01:00.000Z", 2, "@ben.t", "B2 top", 280),       // id 501
  row("2026-11-25T05:02:00.000Z", 3, "@cara", "E5 belt", 60),        // id 502
  row("2026-11-26T05:00:00.000Z", 1, "@ana", "C3 bag", 120),         // id 503 — day 2, the same buyer
  row("2026-11-26T05:03:00.000Z", 3, "@cara", "E6 ring", 40),        // id 504
]; };
const buyersOf = (rows: FakeOrderRow[]): Buyer[] => rebuildSessionFromRows(rows as unknown as LiveSessionRow[]).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); }); };
const rowOf = (n: number) => qa("ivc-row").find((r) => r.getAttribute("data-buyer") === String(n))!;
const inRow = (n: number, id: string) => rowOf(n).querySelector(`[data-testid='${id}']`) as HTMLElement;
const sends = () => DB.s.sends.map((r) => `${r.buyer_number}:${r.status}`).sort();
const tap = async (el: HTMLElement | null) => { fireEvent.click(el!); await flush(); };
const tapNext = async () => tap(q("ivc-send-next") || q("ivc-done"));
const xOf = (i: number) => qa("tts-line")[i].querySelector("[data-testid='tts-remove']") as HTMLElement;
const message = () => (q("tts-preview") as HTMLTextAreaElement).value;

function Screen({ rows, onBl, sid = CUR }: { rows: FakeOrderRow[]; onBl?: (h: string) => Promise<BlAddResult>; sid?: string | null }) {
  return (
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(rows)} sessionKey={CUR} sessionId={sid} sellerId="u1" todayId="2026-11-26"
          sessionStartedAt="2026-11-25T04:00:00.000Z" sessionWindowDays={2} tapGuardMs={0} {...(onBl ? { onBlacklistAdd: onBl } : {})} />
      </div>
    </TProvider>
  );
}
async function open(rows = DB.s.orders, onBl?: (h: string) => Promise<BlAddResult>) { const r = render(<Screen rows={rows} onBl={onBl} />); await flush(); return r; }

beforeEach(() => {
  DB.reset(); localStorage.clear(); copyText.mockReset(); copyText.mockImplementation(async () => true); track.mockReset();
  DB.s.orders = ROWS();
});
afterEach(() => cleanup());

describe("Buyer cancelled", () => {
  it("tag Cancelled, row dimmed, total struck through; Send next skips them; N drops by one", async () => {
    await open();
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 3 sent");
    await tap(inRow(2, "ivc-row-view"));
    await tap(q("tts-cancel-buyer"));
    expect(q("tts-sheet")).toBeNull();
    expect(rowOf(2).getAttribute("data-tag")).toBe("cancelled");
    expect(rowOf(2).getAttribute("data-cancelled")).toBe("1");
    expect(inRow(2, "ivc-row-tag").textContent).toBe("Cancelled");
    expect(inRow(2, "ivc-row-total").style.textDecoration).toBe("line-through");
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 2 sent");
    expect(q("ivc-summary-line")!.textContent).toBe(tpl(t.rd_ivc_summary, { date: "11/25 → 11/26", n: 2, sum: "₱570" }));
    expect(sends()).toEqual(["2:cancelled"]);
    await tapNext();                                    // #1 opened
    expect(q("ivc-send-next")!.textContent).toContain("#3");   // #2 is skipped
    await tapNext(); await tapNext();                         // #1 Sent, #3 opened → Done → #3 Sent
    expect(sends()).toEqual(["1:sent", "2:cancelled", "3:sent"]);
    expect(q("ivc-progress-text")!.textContent).toBe("2 of 2 sent");
    expect(q("ivc-finished")!.textContent).toBe(`✓ ${t.rd_ivc_all_done}`);
  });
  it("listed under All, not under Not sent, not under Sent", async () => {
    await open();
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer"));
    expect(q("ivc-filter-all")!.textContent).toBe(`${t.rd_min_all} · 3`);
    expect(q("ivc-filter-not_sent")!.textContent).toBe(`${t.rd_ivc_f_not} · 2`);
    await tap(q("ivc-filter-not_sent"));
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "3"]);
    await tap(q("ivc-filter-sent"));
    expect(qa("ivc-row")).toHaveLength(0);
    await tap(q("ivc-filter-all"));
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2", "3"]);
  });
  it("Undo cancel of a buyer never sent → Not sent (the saved row is removed)", async () => {
    await open();
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer"));
    await tap(inRow(2, "ivc-row-view"));
    expect(q("tts-cancelled-note")!.textContent).toBe(t.rd_ivc_cancelled_note);
    expect(q("tts-copy-open")).toBeNull();                    // nothing to send to a cancelled buyer
    await tap(q("tts-undo-cancel"));
    expect(rowOf(2).getAttribute("data-tag")).toBe("not_sent");
    expect(sends()).toEqual([]);
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 3 sent");
  });
  it("Undo cancel of a buyer Sent before → Sent again, with the FIRST send time", async () => {
    await open();
    await tapNext(); await tapNext();                         // #1 Sent
    const first = DB.s.sends.find((r) => r.buyer_number === 1)!.sent_at;
    DB.s.now = "2026-11-26T09:59:00.000Z";
    await tap(rowOf(1)); await tap(q("tts-cancel-buyer"));
    expect(sends()).toEqual(["1:cancelled"]);
    await tap(rowOf(1)); await tap(q("tts-undo-cancel"));
    expect(rowOf(1).getAttribute("data-tag")).toBe("sent");
    expect(DB.s.sends.find((r) => r.buyer_number === 1)!.sent_at).toBe(first);
  });
  it("after the cancel: 'Add @handle to Blacklist?' — Yes adds through the given add, No adds nothing", async () => {
    const add = vi.fn(async (): Promise<BlAddResult> => ({ kind: "added", id: "x", day: "2026-11-26" }));
    await open(DB.s.orders, add);
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer"));
    expect(q("ivc-bl-title")!.textContent).toBe("Add @ben.t to Blacklist?");
    await tap(q("ivc-bl-yes"));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith("@ben.t");
    expect(q("ivc-bl-result")!.textContent).toBe(tpl(t.rd_bl_added, { buyer: "@ben.t", reason: t.rd_bl_not_out_short }));
    await tap(q("ivc-bl-close"));
    expect(q("ivc-bl-ask")).toBeNull();
    await tap(rowOf(3)); await tap(q("tts-cancel-buyer"));
    await tap(q("ivc-bl-no"));
    expect(q("ivc-bl-ask")).toBeNull();
    expect(add).toHaveBeenCalledTimes(1);                     // No → nothing added
  });
  it("Blacklist answers 'already' / an error → said plainly; the cancel itself is saved either way", async () => {
    const add = vi.fn(async (): Promise<BlAddResult> => ({ kind: "already", day: "2026-11-26" }));
    await open(DB.s.orders, add);
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer")); await tap(q("ivc-bl-yes"));
    expect(q("ivc-bl-result")!.getAttribute("data-result")).toBe("already");
    await tap(q("ivc-bl-close"));
    add.mockImplementation(async () => ({ kind: "error" }));
    await tap(rowOf(3)); await tap(q("tts-cancel-buyer")); await tap(q("ivc-bl-yes"));
    expect(q("ivc-bl-result")!.textContent).toBe(t.rd_bl_save_err);
    expect(sends()).toEqual(["2:cancelled", "3:cancelled"]);
  });
  it("a seller without Blacklist is never asked", async () => {
    await open();
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer"));
    expect(q("ivc-bl-ask")).toBeNull();
    expect(rowOf(2).getAttribute("data-tag")).toBe("cancelled");
  });
  it("RedesignApp gives the screen the Blacklist screen's OWN add, only when the seller has Blacklist", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain(`{...(blacklistOn ? { onBlacklistAdd: (handle: string) => blacklist.add("tiktok", handle, "not_checked_out") } : {})}`);
    expect(src).toContain(`onAdd={blacklist.add}`);              // the Blacklist screen uses the same function
    expect(src).toMatch(/const blacklistOn = blacklistVisible\(/);
  });
  it("a cancel that could not be saved is shown, counted and sent again", async () => {
    DB.s.noCancelStatus = true;                               // like the database before sql/222
    await open();
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer"));
    expect(rowOf(2).getAttribute("data-tag")).toBe("cancelled");
    expect(q("ivc-unsaved")!.textContent).toContain(tpl(t.rd_ivc_unsaved, { n: 1 }));
    DB.s.noCancelStatus = false;
    await tap(q("ivc-unsaved-retry"));
    expect(q("ivc-unsaved")).toBeNull();
    expect(sends()).toEqual(["2:cancelled"]);
  });
});

describe("cancel one item", () => {
  it("× saves that order (by its database id): struck through + Undo, out of the message and the total", async () => {
    await open();
    await tap(inRow(1, "ivc-row-view"));
    expect(message()).toContain("A1 dress");
    expect(message()).toContain("Total: ₱470");
    await tap(xOf(0));                                       // A1 dress = row id 500
    expect(DB.s.lineCancels).toEqual([{ user_id: "u1", session_key: CUR, platform: "tiktok", order_id: 500 }]);
    expect(qa("tts-line-cancelled")).toHaveLength(1);
    expect(q("tts-cut-text")!.textContent).toBe("A1 dress");
    expect(q("tts-cut-text")!.style.textDecoration).toBe("line-through");
    expect(q("tts-line-undo")!.textContent).toBe("Undo");
    expect(message()).not.toContain("A1 dress");
    expect(message()).toContain("C3 bag");
    expect(message()).toContain("Total: ₱120");
    expect((q("tts-total") as HTMLInputElement).value).toBe("120");
    await tap(q("tts-close"));
    expect(inRow(1, "ivc-row-total").textContent).toBe("₱120");
    expect(inRow(1, "ivc-row-items").textContent).toBe("· 1 item");
  });
  it("kept after a reload and on another phone (nothing on the phone)", async () => {
    await open();
    await tap(rowOf(1)); await tap(xOf(0)); await tap(q("tts-close"));
    cleanup(); localStorage.clear();
    await open();
    expect(inRow(1, "ivc-row-total").textContent).toBe("₱120");
    await tap(rowOf(1));
    expect(qa("tts-line-cancelled")).toHaveLength(1);
    expect(message()).not.toContain("A1 dress");
  });
  it("Undo puts the line back (the saved row is removed)", async () => {
    await open();
    await tap(rowOf(1)); await tap(xOf(0));
    await tap(q("tts-line-undo"));
    expect(DB.s.lineCancels).toEqual([]);
    expect(qa("tts-line-cancelled")).toHaveLength(0);
    expect(message()).toContain("A1 dress");
    expect(message()).toContain("Total: ₱470");
  });
  it("Send next copies the message without the cancelled line", async () => {
    await open();
    await tap(rowOf(1)); await tap(xOf(1)); await tap(q("tts-close"));   // C3 bag (row 503, day 2)
    await tapNext();
    const text = copyText.mock.calls[0][0];
    expect(text).toContain("A1 dress");
    expect(text).not.toContain("C3 bag");
    expect(text).toContain("Total: ₱350");
  });
  it("'New item · send again' ignores a line cancelled after the send; a real new order still shows it", async () => {
    await open();
    await tapNext(); await tapNext();                         // #1 Sent with both lines
    await tap(rowOf(1)); await tap(xOf(0)); await tap(q("tts-close"));
    expect(rowOf(1).getAttribute("data-tag")).toBe("sent");
    cleanup();
    DB.s.orders = [...DB.s.orders, row("2026-11-26T08:00:00.000Z", 1, "@ana", "N1 new", 99)];
    await open();
    expect(rowOf(1).getAttribute("data-tag")).toBe("new_item");
  });
  it("the last remaining line asks 'Cancel the whole buyer?' — No changes nothing, Yes cancels the buyer", async () => {
    await open();
    await tap(rowOf(2));
    await tap(xOf(0));
    expect(q("tts-ask-whole")!.textContent).toContain(t.rd_ivc_ask_whole);
    expect(DB.s.lineCancels).toEqual([]);
    await tap(q("tts-ask-whole-no"));
    expect(q("tts-ask-whole")).toBeNull();
    expect(qa("tts-line")).toHaveLength(1);
    await tap(xOf(0));
    await tap(q("tts-ask-whole-yes"));
    expect(sends()).toEqual(["2:cancelled"]);
    expect(DB.s.lineCancels).toEqual([]);
    expect(rowOf(2).getAttribute("data-tag")).toBe("cancelled");
  });
  it("…also when the other lines were already cancelled", async () => {
    await open();
    await tap(rowOf(3)); await tap(xOf(0));
    expect(q("tts-ask-whole")).toBeNull();
    await tap(xOf(0));                                       // the last one left
    expect(q("tts-ask-whole")).not.toBeNull();
  });
  it("no real session id (an old one-day session / not a database id) → the ids come from the time window", async () => {
    for (const sid of [null, "preview-invoice"]) {
      DB.s.lineCancels = []; DB.s.calls = [];
      render(<Screen rows={DB.s.orders} sid={sid} />); await flush();
      await tap(rowOf(1)); await tap(xOf(0));
      expect(DB.s.lineCancels.map((r) => r.order_id)).toEqual([500]);
      const idRead = DB.s.calls.find((c) => c.table === "live_session_orders" && c.filters?.platform === "TikTok")!;
      expect(idRead.filters!.session_id).toBeUndefined();
      cleanup();
    }
  });
  it("a line not paired with its stored order yet keeps today's × (this message only, nothing saved)", async () => {
    DB.s.failIdReads = true;
    await open();
    await tap(rowOf(1)); await tap(xOf(0));
    expect(DB.s.lineCancels).toEqual([]);
    expect(qa("tts-line-cancelled")).toHaveLength(0);
    expect(qa("tts-line")).toHaveLength(1);
    expect(message()).not.toContain("A1 dress");
    await tap(q("tts-close")); await tap(rowOf(1));
    expect(message()).toContain("A1 dress");                 // not saved: a new open has it again
  });
  it("a line cancel that could not be saved is shown, counted and sent again", async () => {
    await open();
    DB.s.failCancelWrites = true;
    await tap(rowOf(1)); await tap(xOf(0)); await tap(q("tts-close"));
    expect(inRow(1, "ivc-row-total").textContent).toBe("₱120");
    expect(q("ivc-unsaved")).not.toBeNull();
    DB.s.failCancelWrites = false;
    await tap(q("ivc-unsaved-retry"));
    expect(q("ivc-unsaved")).toBeNull();
    expect(DB.s.lineCancels.map((r) => r.order_id)).toEqual([500]);
  });
  it("the cancelled lines could not be read → no Send button, a retry", async () => {
    DB.s.failCancelReads = true;
    await open();
    expect(q("ivc-cancels-error")).not.toBeNull();
    expect(q("ivc-send-next")).toBeNull();
    DB.s.failCancelReads = false;
    await tap(q("ivc-cancels-retry"));
    expect(q("ivc-send-next")).not.toBeNull();
  });
});

describe("the session's orders are never written", () => {
  it("orders rows and buyer numbers are byte-identical after cancels, undos and sends; no write reaches them", async () => {
    const before = JSON.stringify(DB.s.orders);
    const add = vi.fn(async (): Promise<BlAddResult> => ({ kind: "added", id: "x", day: "d" }));
    await open(DB.s.orders, add);
    await tap(rowOf(1)); await tap(xOf(0)); await tap(q("tts-line-undo")); await tap(xOf(1)); await tap(q("tts-close"));
    await tap(rowOf(2)); await tap(q("tts-cancel-buyer")); await tap(q("ivc-bl-yes")); await tap(q("ivc-bl-close"));
    await tap(rowOf(2)); await tap(q("tts-undo-cancel"));
    await tapNext(); await tapNext();
    expect(JSON.stringify(DB.s.orders)).toBe(before);
    expect(DB.s.calls.filter((c) => c.table === "live_session_orders" && c.op !== "select")).toEqual([]);
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2", "3"]);
  });
});

describe("pure rules", () => {
  const b = buyersOf(ROWS());
  const ids = new Map<string, number>();
  it("every kept line = exactly the hash saved before cancelled lines existed", () => {
    const r = invoiceRows(b, "tiktok", "")[0];
    expect(r.hash).toBe(linesHashOf(r.receipt));
    expect(keptLinesHash(r.receipt, [true, true])).toBe(linesHashOf(r.receipt));
  });
  it("a cancelled line is left out of lines, total and hash; its earlier hash still counts as Sent", () => {
    const all = invoiceRows(b, "tiktok", "", { ids })[0];
    ids.set("x", 1);
    const withIds = invoiceRows(b, "tiktok", "", { ids: new Map([...b[0].orders.map((o, i) => [`${o.orderNum}|#1|@ana|TikTok|${o.item}|${o.total}`, 500 + i * 3] as const)]), cancelled: new Set([500]) })[0];
    expect(withIds.orderIds).toEqual([500, 503]);
    expect(withIds.cancelled).toEqual([true, false]);
    expect(withIds.lines.map((l) => l.text)).toEqual(["C3 bag"]);
    expect(withIds.total).toBe(120);
    expect(withIds.hash).not.toBe(all.hash);
    expect(withIds.hashes).toContain(all.hash);
    expect(stateOf(withIds, { status: "sent", sentAt: null, hash: all.hash })).toBe("sent");
    expect(stateOf(withIds, { status: "cancelled", sentAt: null, hash: all.hash })).toBe("cancelled");
  });
  it("the sheet in the Orders tab (no invoice) has no Buyer cancelled and its × stays message-only", async () => {
    const receipt = { num: 1, name: "ANA", handle: "@ana", lines: [{ item: "A1", total: 350 }, { item: "B", total: 10 }], count: 2, total: 360, platform: "TikTok" };
    render(<TProvider lang="en"><div data-redesign=""><TikTokSendSheet receipt={receipt} cur="₱" date="11/26" sellerId="u1" onClose={() => {}} /></div></TProvider>);
    expect(q("tts-cancel-buyer")).toBeNull();
    await tap(xOf(0));
    expect(qa("tts-line-cancelled")).toHaveLength(0);
    expect(qa("tts-line")).toHaveLength(1);
  });
});
