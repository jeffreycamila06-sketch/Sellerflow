// Settings → INVOICING, the two follow-ups of 2026-11-26:
//   1) the SESSION PICKER — the same session list and the same buyer cards as the Orders tab's past
//      sessions (adapters/pastSessions.ts), status per session, no "old session" question here;
//   2) COPY FAILED = NOT SENT — a refused copy never marks a buyer Sent; the button stays on that buyer.
// Database = the in-memory stand-in (invoiceFakeDb.ts), which also answers the past-session reads.
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
import Orders from "../Orders";
import { DB, type FakeOrderRow } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { buyerReceipts } from "../../adapters/useReadData";
import { invoiceRows, loadPending, savePending } from "../../adapters/invoicing";
import { pastSessionFromRows, sessionRange, summariesFromRpc } from "../../adapters/pastSessions";

const t = buildT("en");
const CUR = "cur-session", P2 = "past-two-day", P1 = "past-one-day";
const row = (sid: string, at: string, n: number, handle: string, product: string, price: number, platform = "TikTok", uid = "u1"): FakeOrderRow =>
  ({ user_id: uid, session_id: sid, session_date: at.slice(0, 10), created_at: at, buyer_number: n, handle, customer_name: handle.replace("@", "").toUpperCase(), platform, product, price, qty: 1, comment_msg_id: null, auto_code: null });
// the running session (Nov 26), a two-day past session (Nov 24 → 25) and an older one-day one (Nov 20)
const CUR_ROWS = [
  row(CUR, "2026-11-26T05:00:00.000Z", 1, "@ana", "A1 dress", 350),
  row(CUR, "2026-11-26T05:01:00.000Z", 2, "@ben.t", "B2 top", 280),
  row(CUR, "2026-11-26T05:02:00.000Z", 3, "@cara", "E5 belt", 60),
];
const P2_ROWS = [
  row(P2, "2026-11-24T05:00:00.000Z", 1, "@dina", "K1 skirt", 400),
  row(P2, "2026-11-25T06:00:00.000Z", 1, "@dina", "K2 scarf", 150),          // day 2, same buyer → ONE row
  row(P2, "2026-11-24T05:05:00.000Z", 2, "@ana", "K3 hat", 90),               // the same person as today's #1, another session
  row(P2, "2026-11-25T06:10:00.000Z", 3, "@efren", "K4 shoes", 700),
  row(P2, "2026-11-25T06:20:00.000Z", 4, "Fb Buyer", "FB top", 500, "Facebook"),
];
const P1_ROWS = [row(P1, "2026-11-20T05:00:00.000Z", 1, "@gia", "Z9 coat", 990)];
const OTHER_SELLER = [row("theirs", "2026-11-23T05:00:00.000Z", 1, "@zed", "X", 10, "TikTok", "u2")];
const buyersOf = (rows: FakeOrderRow[]): Buyer[] => rebuildSessionFromRows(rows as unknown as LiveSessionRow[]).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const rowOf = (n: number) => qa("ivc-row").find((r) => r.getAttribute("data-buyer") === String(n))!;
const tags = () => qa("ivc-row").map((r) => `${r.getAttribute("data-buyer")}:${r.getAttribute("data-tag")}`);
const sendsOf = (session: string) => DB.s.sends.filter((r) => r.session_key === session).map((r) => `${r.buyer_number}:${r.status}`).sort();
const tap = async (id: string) => { fireEvent.click(q(id)!); await flush(); };
const tapNext = async () => { fireEvent.click(q("ivc-send-next") || q("ivc-done")!); await flush(); };
const item = (sid: string) => qa("ivc-session-item").find((b) => b.getAttribute("data-session") === sid)!;
const pick = async (sid: string | null) => {
  if (!q("ivc-session-menu")) await tap("ivc-session-btn");
  fireEvent.click(sid ? item(sid) : q("ivc-session-current")!);
  await flush();
};

function Screen({ pastSessions = true, sellerId = "u1" }: { pastSessions?: boolean; sellerId?: string }) {
  return (
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(CUR_ROWS)} sessionKey={CUR} sessionId={CUR} pastSessions={pastSessions} sellerId={sellerId} todayId="2026-11-26"
          sessionStartedAt="2026-11-26T04:00:00.000Z" sessionWindowDays={1} tapGuardMs={0} />
      </div>
    </TProvider>
  );
}
async function open(props: Parameters<typeof Screen>[0] = {}) { const r = render(<Screen {...props} />); await flush(); return r; }

beforeEach(() => {
  DB.reset(); localStorage.clear(); copyText.mockReset(); copyText.mockImplementation(async () => true); track.mockReset();
  DB.s.orders = [...CUR_ROWS, ...P2_ROWS, ...P1_ROWS, ...OTHER_SELLER];
});
afterEach(() => cleanup());

describe("the session picker", () => {
  it("the button says This session and its date; the list is not read until it is opened", async () => {
    await open();
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/26");
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("0");
    expect(q("ivc-session-menu")).toBeNull();
    expect(DB.s.calls.some((c) => c.op === "rpc")).toBe(false);
    // (the order-id read of the CURRENT session — invoicing-cancel, it has a platform filter — is not the past list)
    expect(DB.s.calls.some((c) => c.table === "live_session_orders" && c.filters?.platform === undefined)).toBe(false);
  });
  it("opened: the current session first, then the past ones newest first, a multi-day one as a range", async () => {
    await open();
    await tap("ivc-session-btn");
    expect(q("ivc-session-current")!.textContent).toBe("This session · 11/26");
    expect(q("ivc-session-current")!.getAttribute("aria-current")).toBe("true");
    expect(qa("ivc-session-item").map((b) => b.textContent)).toEqual([
      "Past session · 11/24 → 11/25 · 2 days",
      "Past session · 11/20 · 1 day",
    ]);
  });
  it("it IS the Orders tab's list: the same database function, the same summaries, the same order", async () => {
    await open();
    await tap("ivc-session-btn");
    expect(DB.s.calls.filter((c) => c.op === "rpc").map((c) => c.table)).toEqual(["rpc:my_session_summaries"]);
    const { data } = await DB.supabase.rpc("my_session_summaries");
    const ordersList = summariesFromRpc(data as never, CUR).filter((s) => !s.current);
    expect(qa("ivc-session-item").map((b) => b.getAttribute("data-session"))).toEqual(ordersList.map((s) => s.id));
    expect(qa("ivc-session-item").map((b) => b.textContent)).toEqual(
      ordersList.map((s) => tpl(t.rd_psn_row, { range: sessionRange(s), days: s.days === 1 ? t.rd_psn_day1 : tpl(t.rd_psn_days, { n: s.days }) })));
    cleanup();
    // …and the Orders tab itself, on the same data, lists the same sessions with the same words
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="₱" orders={[]} state="live" buyers={buyersOf(CUR_ROWS)} todayId="2026-11-26" sessionId={CUR} pastSessions sellerId="u1" /></TProvider>);
    await flush();
    await tap("ord-range");
    expect(qa("ord-session-item").map((b) => b.textContent)).toEqual(["Past session · 11/24 → 11/25 · 2 days", "Past session · 11/20 · 1 day"]);
  });
  it("another seller's sessions are not in the list", async () => {
    await open();
    await tap("ivc-session-btn");
    expect(qa("ivc-session-item").some((b) => b.getAttribute("data-session") === "theirs")).toBe(false);
  });
  it("a seller without past sessions has no picker — the screen as before", async () => {
    await open({ pastSessions: false });
    expect(q("ivc-session")).toBeNull();
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
  });
  it("the list could not be read → it says so; no past sessions → it says so", async () => {
    DB.s.failSummaries = true;
    await open();
    await tap("ivc-session-btn");
    expect(q("ivc-session-error")!.textContent).toBe(t.rd_psn_failed);
    expect(qa("ivc-session-item")).toEqual([]);
    cleanup();
    DB.s.failSummaries = false; DB.s.orders = [...CUR_ROWS];
    await open();
    await tap("ivc-session-btn");
    expect(q("ivc-session-none")!.textContent).toBe(t.rd_psn_none);
  });
});

describe("a past session", () => {
  it("picked: amber header 'Past session · range', that session's TikTok buyers, all its days in one row", async () => {
    await open();
    await pick(P2);
    expect(q("ivc-session-menu")).toBeNull();
    expect(q("ivc-session-label")!.textContent).toBe("Past session · 11/24 → 11/25");
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("1");
    expect(q("ivc-session-btn")!.style.background).toBe("rgb(254, 243, 199)");       // amber
    expect(q("ivc-past-line")!.textContent).toBe("Past session · 11/24 → 11/25");
    expect(q("ivc-past-line")!.style.color).toBe("rgb(146, 64, 14)");
    expect(q("ivc-summary-line")!.textContent).toBe("3 buyers · ₱1,340");
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2", "3"]);   // the Facebook buyer is not listed
    expect(rowOf(1).querySelector("[data-testid='ivc-row-handle']")!.textContent).toBe("@dina");
    expect(rowOf(1).querySelector("[data-testid='ivc-row-total']")!.textContent).toBe("₱550");   // day 1 + day 2
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #1 @dina · ₱550");
  });
  it("its rows ARE the Orders tab's past buyer cards (the same loader, the same grouping)", async () => {
    await open();
    await pick(P2);
    // what Orders builds for that session: pastSessionFromRows → buyerReceipts
    const stored = DB.s.orders.filter((r) => r.session_id === P2);
    const ordersBuyers = pastSessionFromRows(stored as never).buyers;
    const want = invoiceRows(ordersBuyers, "tiktok", "");
    expect(want.map((r) => r.receipt)).toEqual(
      [...new Set(ordersBuyers.filter((b) => b.platform === "TikTok").map((b) => b.num))].flatMap((n) => buyerReceipts(ordersBuyers, n).filter((c) => c.platform === "TikTok")));
    expect(qa("ivc-row").map((r) => `${r.getAttribute("data-buyer")}|${r.querySelector("[data-testid='ivc-row-handle']")!.textContent}|${r.querySelector("[data-testid='ivc-row-total']")!.textContent}`))
      .toEqual(want.map((r) => `${r.num}|${r.receipt.handle}|₱${r.total.toLocaleString("en-US")}`));
    // one read of that session's stored rows, by its id — the read the Orders tab makes
    // (the small order-id reads — invoicing-cancel, they have a platform filter — are counted apart)
    const reads = DB.s.calls.filter((c) => c.table === "live_session_orders" && c.filters?.platform === undefined);
    expect(reads.length).toBe(1);
    expect(reads[0].filters).toMatchObject({ user_id: "u1", session_id: P2 });
  });
  it("the message carries that session's range, and Send next saves under THAT session", async () => {
    await open();
    await pick(P2);
    await tapNext();
    expect(copyText.mock.calls[0][0]).toContain("11/24 → 11/25");
    expect(copyText.mock.calls[0][0]).toContain("K1 skirt");
    expect(copyText.mock.calls[0][0]).toContain("K2 scarf");
    await tapNext();
    expect(sendsOf(P2)).toEqual(["1:sent"]);
    expect(sendsOf(CUR)).toEqual([]);
    expect(tags()).toEqual(["1:sent", "2:sending", "3:next"]);
  });
  it("NO 'old session — send anyway?' question in Invoicing: the row sheet sends at once, with the past line", async () => {
    await open();
    await pick(P2);
    fireEvent.click(rowOf(3));
    expect(q("tts-past")!.textContent).toBe("Past session 11/24 → 11/25");
    expect(q("tts-old-confirm")).toBeNull();
    expect(q("tts-old-yes")).toBeNull();
    await tap("tts-copy-open");
    expect(sendsOf(P2)).toEqual(["3:sent"]);
  });
  it("…and the Orders tab still asks it (unchanged)", async () => {
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="₱" orders={[]} state="live" buyers={buyersOf(CUR_ROWS)} todayId="2026-11-26" sessionId={CUR} pastSessions tiktokSend sellerId="u1" /></TProvider>);
    await flush();
    await tap("ord-range");
    fireEvent.click(qa("ord-session-item")[0]); await flush();
    fireEvent.change(document.querySelectorAll("input")[0], { target: { value: "3" } }); await flush();
    await tap("tt-send-btn");
    expect(q("tts-old-confirm")!.textContent).toContain("This is an OLD session (11/24 → 11/25). Send anyway?");
    expect(q("tts-copy-open")).toBeNull();
    const src = readFileSync("src/redesign/screens/Orders.tsx", "utf8");
    expect(src).toContain("pastRange={pastSel ? sessionRange(pastSel) : undefined}");
  });
  it("New item works the same in a past session", async () => {
    await open();
    await pick(P2);
    await tapNext(); await tapNext();
    expect(tags()[0]).toBe("1:sent");
    cleanup();
    DB.s.orders.push(row(P2, "2026-11-25T08:00:00.000Z", 1, "@dina", "K9 late item", 75));
    await open();
    await pick(P2);
    expect(rowOf(1).getAttribute("data-tag")).toBe("new_item");
    expect(q("ivc-send-next")!.getAttribute("data-buyer")).toBe("1");
  });
  it("still loading → no button; the session could not be read → a retry that works", async () => {
    DB.s.failPast = true;
    await open();
    await pick(P2);
    expect(q("ivc-past-error")!.textContent).toContain(t.rd_psn_failed);
    expect(q("ivc-send-next")).toBeNull();
    expect(qa("ivc-row")).toEqual([]);
    DB.s.failPast = false;
    await tap("ivc-past-retry");
    expect(qa("ivc-row").length).toBe(3);
  });
  it("a Facebook-only session is not in the TikTok tab's list (each tab lists its own platform's sessions)", async () => {
    DB.s.orders.push(row("fb-only", "2026-11-22T05:00:00.000Z", 1, "Fb Only", "F", 10, "Facebook"));
    await open();
    await tap("ivc-session-btn");
    expect(qa("ivc-session-item").map((b) => b.getAttribute("data-session"))).toEqual([P2, P1]);
  });
});

describe("the status is per session", () => {
  it("tags of two sessions are kept apart — the same buyer number, even the same person", async () => {
    await open();
    await tapNext(); await tapNext();                       // this session: #1 @ana Sent, #2 being sent
    expect(tags()).toEqual(["1:sent", "2:sending", "3:next"]);
    await pick(P2);
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);      // nothing of this session's tags
    fireEvent.click(rowOf(2)); await tap("tts-skip");                        // past: #2 @ana → Can't message
    expect(tags()).toEqual(["1:next", "2:skipped", "3:not_sent"]);
    await pick(null);
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/26");
    expect(tags()).toEqual(["1:sent", "2:sending", "3:next"]);          // back as it was, "Sending…" too
    expect(sendsOf(CUR)).toEqual(["1:sent"]);
    expect(sendsOf(P2)).toEqual(["2:skipped"]);
    expect(DB.s.sends.find((r) => r.session_key === P2)!.buyer_key).toBe(DB.s.sends.find((r) => r.session_key === CUR)!.buyer_key);   // the same person (@ana) — only the session keeps them apart
  });
  it("the old session's tags are never shown for the new one, not even while it loads", async () => {
    await open();
    await tapNext(); await tapNext();
    await tap("ivc-session-btn");
    fireEvent.click(item(P2));
    // right after the pick, before anything is read: no row of either session
    expect(qa("ivc-row")).toEqual([]);
    expect(q("ivc-send-next")).toBeNull();
    await flush();
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
  });
  it("…also going BACK to this session, where the same buyer has the same number (rows are there at once)", async () => {
    DB.s.orders.push(row("twin", "2026-11-22T05:00:00.000Z", 1, "@ana", "T1 old dress", 111));   // #1 @ana, as today
    await open();
    await pick("twin");
    await tapNext(); await tapNext();
    expect(sendsOf("twin")).toEqual(["1:sent"]);
    expect(tags()).toEqual(["1:sent"]);
    await tap("ivc-session-btn");
    fireEvent.click(q("ivc-session-current")!);
    // right after the pick: today's rows could be drawn at once — never with the other session's "Sent"
    expect(tags().filter((x) => x.endsWith(":sent"))).toEqual([]);
    expect(q("ivc-send-next")).toBeNull();                 // nothing can be sent until this session's status is read
    await flush();
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
    expect(sendsOf(CUR)).toEqual([]);
  });
  it("'Sending…' is remembered per session on this phone", async () => {
    savePending("u1", CUR, "tiktok", "A"); savePending("u1", P2, "tiktok", "B");
    expect(loadPending("u1", CUR, "tiktok")).toBe("A");
    expect(loadPending("u1", P2, "tiktok")).toBe("B");
    savePending("u1", CUR, "tiktok", null);
    expect(loadPending("u1", CUR, "tiktok")).toBeNull();
    expect(loadPending("u1", P2, "tiktok")).toBe("B");
    expect(loadPending("u2", P2, "tiktok")).toBeNull();
    for (let i = 0; i < 30; i++) savePending("u1", `s${i}`, "tiktok", "x");   // never grows without end
    expect(Object.keys(JSON.parse(localStorage.getItem("sfl_rd_invoice_pending:u1")!)).length).toBeLessThanOrEqual(12);
    localStorage.setItem("sfl_rd_invoice_pending:u1", JSON.stringify({ s: "S1", p: "tiktok", id: "old-shape" }));   // the first build's shape
    expect(loadPending("u1", "S1", "tiktok")).toBeNull();
  });
  it("picking a session writes nothing and changes nothing outside this screen's own reads", async () => {
    await open();
    await pick(P2); await pick(P1); await pick(null);
    expect(DB.s.calls.filter((c) => c.op === "upsert")).toEqual([]);
    expect(DB.s.sends).toEqual([]);
    expect(DB.s.orders.length).toBe(CUR_ROWS.length + P2_ROWS.length + P1_ROWS.length + OTHER_SELLER.length);
    const src = readFileSync("src/redesign/screens/Invoicing.tsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/useLiveSession|applyOrder|createOrder|useOrders|printSlip|startSession|end_session|setScreen/);
  });
});

describe("copy failed = not sent", () => {
  it("Send next, copy refused: NOT being sent, tag 'Copy failed', the message shown selected, the button stays on that buyer", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    await tapNext();
    expect(tags()).toEqual(["1:copy_failed", "2:not_sent", "3:not_sent"]);
    expect(rowOf(1).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("Copy failed");
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #1 @ana");
    expect(q("ivc-send-next")!.getAttribute("data-again")).toBe("1");
    const box = q("ivc-copy-fail-text") as HTMLTextAreaElement;
    expect(box.value).toContain("A1 dress");
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 3 sent");
    expect(DB.s.sends).toEqual([]);
    expect(loadPending("u1", CUR, "tiktok")).toBeNull();         // nothing "being sent" is remembered
  });
  it("pressing again while the copy is still refused: still that buyer, still nobody Sent — however many times", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    await tapNext(); await tapNext(); await tapNext(); await tapNext();
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #1 @ana");
    expect(tags()).toEqual(["1:copy_failed", "2:not_sent", "3:not_sent"]);
    expect(DB.s.sends).toEqual([]);
    expect(copyText.mock.calls.map((c) => c[0].includes("A1 dress"))).toEqual([true, true, true, true]);   // always #1's message
  });
  it("the next copy works → the normal flow: being sent, then Send next marks them Sent", async () => {
    copyText.mockImplementationOnce(async () => false);
    await open();
    await tapNext();
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #1 @ana");
    expect((q("ivc-send-next") as HTMLAnchorElement).getAttribute("href")).toBe("https://www.tiktok.com/@ana");   // the press opens TikTok
    await tapNext();                                                     // the copy works now
    expect(q("ivc-copy-fail-text")).toBeNull();
    expect(tags()).toEqual(["1:sending", "2:next", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #2 @ben.t · ₱280");
    expect(DB.s.sends).toEqual([]);
    await tapNext();
    expect(sendsOf(CUR)).toEqual(["1:sent"]);
    expect(q("ivc-progress-text")!.textContent).toBe("1 of 3 sent");
  });
  it("the buyer sent BEFORE the refused one is still marked Sent; the refused one is not", async () => {
    await open();
    await tapNext();                                          // #1 copied, TikTok opened
    copyText.mockImplementation(async () => false);
    await tapNext();                                          // #1 → Sent; #2's copy refused
    expect(sendsOf(CUR)).toEqual(["1:sent"]);
    expect(tags()).toEqual(["1:sent", "2:copy_failed", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #2 @ben.t");
    await tapNext();
    expect(sendsOf(CUR)).toEqual(["1:sent"]);                 // #2 never counted
  });
  it("the row sheet, copy refused: not Sent, 'Copy failed' on the row, the big button goes to that buyer", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    fireEvent.click(rowOf(2));
    await tap("tts-copy-open");
    expect(DB.s.sends).toEqual([]);
    expect(q("tts-status")!.textContent).toBe(t.rd_tts_copy_failed);
    expect(document.activeElement).toBe(q("tts-preview"));
    await tap("tts-close");
    expect(tags()).toEqual(["1:not_sent", "2:copy_failed", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #2 @ben.t");
    copyText.mockImplementation(async () => true);
    await tapNext();
    expect(tags()).toEqual(["1:next", "2:sending", "3:not_sent"]);
    await tapNext();
    expect(sendsOf(CUR)).toEqual(["2:sent"]);
  });
  it("the row sheet: a copy that works after a refused one marks Sent and clears 'Copy failed'", async () => {
    copyText.mockImplementationOnce(async () => false);
    await open();
    fireEvent.click(rowOf(2));
    await tap("tts-copy-open");
    expect(DB.s.sends).toEqual([]);
    await tap("tts-copy-open");
    expect(sendsOf(CUR)).toEqual(["2:sent"]);
    await tap("tts-close");
    expect(tags()).toEqual(["1:next", "2:sent", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #1 @ana · ₱350");
  });
  it("a refused 'Send again' on a buyer already Sent leaves them Sent", async () => {
    await open();
    fireEvent.click(rowOf(1)); await tap("tts-copy-open"); await tap("tts-close");
    expect(sendsOf(CUR)).toEqual(["1:sent"]);
    copyText.mockImplementation(async () => false);
    fireEvent.click(rowOf(1)); await tap("tts-copy-open"); await tap("tts-close");
    expect(tags()).toEqual(["1:sent", "2:next", "3:not_sent"]);
    expect(q("ivc-send-next")!.getAttribute("data-again")).toBe("0");
  });
  it("'Can't message' on a copy-failed buyer frees the button", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    await tapNext();
    fireEvent.click(rowOf(1)); await tap("tts-skip");
    expect(tags()).toEqual(["1:skipped", "2:next", "3:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #2 @ben.t · ₱280");
  });
  it("'Copy failed' is on this phone only: nothing is saved, and it is gone after leaving the screen", async () => {
    copyText.mockImplementation(async () => false);
    const r = await open();
    await tapNext();
    expect(DB.s.calls.filter((c) => c.op === "upsert")).toEqual([]);
    expect(JSON.stringify({ ...localStorage })).not.toContain("copy");
    r.unmount();
    await open();
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);      // Not sent again — never Sent
  });
  it("a number-only id: 'Copy again' is a button (no link), as before", async () => {
    DB.s.orders = [row(CUR, "2026-11-26T05:00:00.000Z", 1, "7234567890123456789", "D4 cap", 90)];
    copyText.mockImplementation(async () => false);
    render(<TProvider lang="en"><div data-redesign=""><Invoicing cur="₱" onBack={() => {}} buyers={buyersOf(DB.s.orders)} sessionKey={CUR} sessionId={CUR} pastSessions sellerId="u1" todayId="2026-11-26" tapGuardMs={0} /></div></TProvider>);
    await flush();
    await tapNext();
    expect(q("ivc-send-next")!.tagName).toBe("BUTTON");
    expect(q("ivc-send-next")!.textContent).toBe("Copy again · #1 7234567890123456789");
  });
  it("in a past session too, and switching session forgets it (it was never Sent)", async () => {
    await open();
    await pick(P2);
    copyText.mockImplementation(async () => false);
    await tapNext();
    expect(tags()).toEqual(["1:copy_failed", "2:not_sent", "3:not_sent"]);
    await pick(null);
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
    await pick(P2);
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent"]);
    expect(DB.s.sends).toEqual([]);
  });
  it("analytics: no buyer, no message — only platform / via / link", async () => {
    copyText.mockImplementationOnce(async () => false);
    await open();
    await tapNext(); await tapNext();
    expect(track.mock.calls.map((c) => c[1])).toEqual([{ platform: "tiktok", via: "next", link: true }, { platform: "tiktok", via: "again", link: true }]);
  });
});
