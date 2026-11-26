// Settings → INVOICING, the screen (TikTok "Send next"). The database is a small in-memory stand-in
// (adapters/__tests__/invoiceFakeDb.ts) shared by every render, so "another device" is simply a second
// render with an empty phone storage.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const track = vi.hoisted(() => vi.fn());
vi.mock("../../analytics", async (orig) => ({ ...(await orig<object>()), track }));

import { TProvider, buildT } from "../../i18n";
import Invoicing, { SEND_NEXT_GUARD_MS } from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { buyerKeyOf, invoiceMessage, invoiceRows } from "../../adapters/invoicing";

const t = buildT("en");
const LABELS = { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total, shipping: t.rd_tts_msg_shipping };
const o = (n: number, handle: string, product: string, price: number, at = "2026-11-26T05:00:00.000Z", platform = "TikTok"): LiveSessionRow =>
  ({ buyer_number: n, handle, customer_name: handle.replace("@", "").toUpperCase(), platform, product, price, created_at: at, session_date: at.slice(0, 10) });
const BASE: LiveSessionRow[] = [
  o(1, "@ana", "A1 dress", 350), o(1, "@ana", "C3 bag", 120, "2026-11-26T05:20:00.000Z"),
  o(2, "@ben.t", "B2 top", 280, "2026-11-26T05:01:00.000Z"),
  o(3, "7234567890123456789", "D4 cap", 90, "2026-11-26T05:02:00.000Z"),
  o(4, "@cara", "E5 belt", 60, "2026-11-26T05:03:00.000Z"),
  o(5, "Fb Buyer", "FB top", 500, "2026-11-26T05:04:00.000Z", "Facebook"),
];
const buyersOf = (rows: LiveSessionRow[]): Buyer[] => rebuildSessionFromRows(rows).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const rowOf = (n: number) => qa("ivc-row").find((r) => r.getAttribute("data-buyer") === String(n))!;
const tags = () => qa("ivc-row").map((r) => `${r.getAttribute("data-buyer")}:${r.getAttribute("data-tag")}`);
const sendsOf = (uid = "u1") => DB.s.sends.filter((r) => r.user_id === uid).map((r) => `${r.buyer_number}:${r.status}`).sort();

function Screen({ buyers, sessionKey = "S1", sellerId = "u1", cur = "₱", onReceiptFormat, tapGuard = 0 }: { buyers: Buyer[]; sessionKey?: string; sellerId?: string; cur?: string; onReceiptFormat?: () => void; tapGuard?: number | "app" }) {
  return (
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur={cur} onBack={() => {}} buyers={buyers} sessionKey={sessionKey} sellerId={sellerId} todayId="2026-11-26" sessionStartedAt="2026-11-26T04:00:00.000Z" sessionWindowDays={1}
          {...(tapGuard === "app" ? {} : { tapGuardMs: tapGuard })} {...(onReceiptFormat ? { onReceiptFormat } : {})} />
      </div>
    </TProvider>
  );
}
async function open(buyers = buyersOf(BASE), props: Partial<Parameters<typeof Screen>[0]> = {}) {
  const r = render(<Screen buyers={buyers} {...props} />);
  await flush();
  return r;
}
const tapNext = async () => { fireEvent.click(q("ivc-send-next") || q("ivc-done")!); await flush(); };

beforeEach(() => { DB.reset(); localStorage.clear(); copyText.mockReset(); copyText.mockImplementation(async () => true); track.mockReset(); });
afterEach(() => cleanup());

describe("the TikTok tab", () => {
  it("one row per TikTok buyer in buyer-number order, with handle, total and tag; Facebook buyers are not listed", async () => {
    await open();
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2", "3", "4"]);
    expect(rowOf(1).textContent).toContain("#1");
    expect(rowOf(1).querySelector("[data-testid='ivc-row-handle']")!.textContent).toBe("@ana");
    expect(rowOf(1).querySelector("[data-testid='ivc-row-total']")!.textContent).toBe("₱470");   // both of her lines
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent", "4:not_sent"]);
    expect(rowOf(1).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("▶ Next");
    expect(rowOf(2).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("Not sent");
  });
  it("summary, progress and the big button", async () => {
    await open();
    expect(q("ivc-summary-line")!.textContent).toBe("Live 11/26 · 4 buyers · ₱900");
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 4 sent");
    expect(q("ivc-progress")!.getAttribute("aria-valuenow")).toBe("0");
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #1 @ana · ₱470");
    expect(q("ivc-hint")!.textContent).toBe("In TikTok: Message → Paste → Send, then come back here.");
  });
  it("the default shipping fee is in every row's total, in the sum and in the message", async () => {
    DB.s.settings.set("u1", { user_id: "u1", note: "GCash 0917", invoice_shipping_fee: 38, opening: "Hello", qr_image: "u1/qr.png" });
    await open();
    expect(rowOf(1).querySelector("[data-testid='ivc-row-total']")!.textContent).toBe("₱508");
    expect(q("ivc-summary-line")!.textContent).toBe("Live 11/26 · 4 buyers · ₱1,052");
    fireEvent.click(q("ivc-send-next")!); await flush();
    const text = copyText.mock.calls[0][0];
    expect(text).toContain("Shipping fee: ₱38");
    expect(text).toContain("Total: ₱508");
    expect(text.endsWith("\n\nGCash 0917")).toBe(true);
  });
});

describe("Send next", () => {
  it("a tap copies that buyer's Send-to-TikTok message and the button is a real link to the buyer's TikTok profile", async () => {
    await open();
    const a = q("ivc-send-next") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://www.tiktok.com/@ana");
    expect(a.getAttribute("target")).toBe("_blank");
    fireEvent.click(a); await flush();
    const row1 = invoiceRows(buyersOf(BASE), "tiktok", "")[0];
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText.mock.calls[0][0]).toBe(invoiceMessage(row1, { cur: "₱", note: "", fee: "", date: "11/26", labels: LABELS }));
    expect(q("ivc-line")!.textContent).toBe(t.rd_tts_copied_open);
    // nothing is saved yet: the buyer is "being sent" until the seller comes back and taps again
    expect(DB.s.sends).toEqual([]);
    expect(tags()).toEqual(["1:sending", "2:next", "3:not_sent", "4:not_sent"]);
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #2 @ben.t · ₱280");
  });
  it("pressing again marks the previous buyer Sent and goes on in buyer-number order; the last one ends with Done", async () => {
    await open();
    await tapNext();                                     // #1 opened
    await tapNext();                                     // #1 sent, #2 opened
    expect(sendsOf()).toEqual(["1:sent"]);
    expect(tags()).toEqual(["1:sent", "2:sending", "3:next", "4:not_sent"]);
    expect(q("ivc-progress-text")!.textContent).toBe("1 of 4 sent");
    await tapNext();                                     // #2 sent, #3 opened
    await tapNext();                                     // #3 sent, #4 opened
    expect(sendsOf()).toEqual(["1:sent", "2:sent", "3:sent"]);
    expect(q("ivc-send-next")).toBeNull();
    expect(q("ivc-done")!.textContent).toBe("Done");
    expect(tags()).toEqual(["1:sent", "2:sent", "3:sent", "4:sending"]);
    const copies = copyText.mock.calls.length;
    await tapNext();                                     // Done → #4 sent
    expect(copyText.mock.calls.length).toBe(copies);     // Done copies nothing and opens nothing
    expect(sendsOf()).toEqual(["1:sent", "2:sent", "3:sent", "4:sent"]);
    expect(q("ivc-done")).toBeNull();
    expect(q("ivc-finished")!.textContent).toBe(`✓ ${t.rd_ivc_all_done}`);
    expect(q("ivc-progress-text")!.textContent).toBe("4 of 4 sent");
  });
  it("a Sent row shows its saved time", async () => {
    DB.s.now = new Date(2026, 10, 26, 9, 12).toISOString();
    await open();
    await tapNext(); await tapNext();
    expect(rowOf(1).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("✓ Sent 9:12");
  });
  it("a number-only TikTok id: the button is NOT a link — the message is copied and a note says to find the buyer by hand", async () => {
    await open(buyersOf([o(3, "7234567890123456789", "D4 cap", 90)]));
    const b = q("ivc-send-next")!;
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("data-copy-only")).toBe("1");
    expect(document.querySelector("a[href*='tiktok.com']")).toBeNull();
    expect(q("ivc-copy-note")!.textContent).toBe(t.rd_ivc_copy_note);
    fireEvent.click(b); await flush();
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(q("ivc-line")!.textContent).toBe(t.rd_tts_copy_find);
    expect(q("ivc-done")).not.toBeNull();
  });
  it("copy refused → the message is shown, selected, to copy by hand", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    fireEvent.click(q("ivc-send-next")!); await flush();
    const box = q("ivc-copy-fail-text") as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    expect(box.value).toContain("A1 dress");
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
    expect(q("ivc-line")).toBeNull();                    // never "Copied"
  });
  it("a double tap does nothing the second time: no mark, no second copy, no TikTok; a later tap goes on", async () => {
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(1_000_000);
      await open(buyersOf(BASE), { tapGuard: "app" });                     // the app's own guard
      fireEvent.click(q("ivc-send-next")!); await flush();                  // #1 opened
      clock.mockReturnValue(1_000_000 + SEND_NEXT_GUARD_MS - 1);
      const second = q("ivc-send-next")!;                                   // now reads #2
      const stopped = !fireEvent.click(second); await flush();              // false = the link's navigation was prevented
      expect(stopped).toBe(true);
      expect(copyText).toHaveBeenCalledTimes(1);
      expect(DB.s.sends).toEqual([]);
      expect(tags()).toEqual(["1:sending", "2:next", "3:not_sent", "4:not_sent"]);
      clock.mockReturnValue(1_000_000 + SEND_NEXT_GUARD_MS + 1);
      fireEvent.click(q("ivc-send-next")!); await flush();
      expect(sendsOf()).toEqual(["1:sent"]);
      expect(copyText).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it("leaving and coming back keeps the buyer being sent (this phone)", async () => {
    const r = await open();
    await tapNext();
    r.unmount();
    await open();
    expect(tags()).toEqual(["1:sending", "2:next", "3:not_sent", "4:not_sent"]);
    await tapNext();
    expect(sendsOf()).toEqual(["1:sent"]);
  });
});

describe("tags, New item, filters", () => {
  it("New item after sent: a later order of a sent buyer → amber tag, back in Send next, counted as not sent", async () => {
    const r = await open();
    await tapNext(); await tapNext();                    // #1 sent, #2 being sent
    r.rerender(<Screen buyers={buyersOf([...BASE, o(1, "@ana", "F6 scarf", 80, "2026-11-26T06:00:00.000Z")])} />);
    await flush();
    expect(rowOf(1).getAttribute("data-tag")).toBe("new_item");
    expect(rowOf(1).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("⚠ New item · send again");
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 4 sent");
    expect(q("ivc-send-next")!.textContent).toBe("Send next · #1 @ana · ₱550");
  });
  it("the filter chips: All · Not sent · Sent", async () => {
    await open();
    await tapNext(); await tapNext();                    // #1 sent
    expect(q("ivc-filter-all")!.textContent).toBe("All · 4");
    expect(q("ivc-filter-not_sent")!.textContent).toBe("Not sent · 3");
    expect(q("ivc-filter-sent")!.textContent).toBe("Sent · 1");
    fireEvent.click(q("ivc-filter-sent")!);
    expect(qa("ivc-row").map((x) => x.getAttribute("data-buyer"))).toEqual(["1"]);
    fireEvent.click(q("ivc-filter-not_sent")!);
    expect(qa("ivc-row").map((x) => x.getAttribute("data-buyer"))).toEqual(["2", "3", "4"]);
    fireEvent.click(q("ivc-filter-all")!);
    expect(qa("ivc-row")).toHaveLength(4);
  });
  it("an empty filter says so", async () => {
    await open();
    fireEvent.click(q("ivc-filter-sent")!);
    expect(q("ivc-empty-filter")!.textContent).toBe(t.rd_ivc_empty_filter);
  });
});

describe("a row's sheet (the Send to TikTok sheet)", () => {
  it("Send = copy + the profile link, and the buyer is Sent; the button then reads Send again", async () => {
    await open();
    fireEvent.click(rowOf(2));
    const send = q("tts-copy-open") as HTMLAnchorElement;
    expect(send.textContent).toBe(t.rd_ivc_send);
    expect(send.getAttribute("href")).toBe("https://www.tiktok.com/@ben.t");
    expect((q("tts-preview") as HTMLTextAreaElement).value).toContain("B2 top");
    fireEvent.click(send); await flush();
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(sendsOf()).toEqual(["2:sent"]);
    expect(q("tts-copy-open")!.textContent).toBe(t.rd_ivc_send_again);
    fireEvent.click(q("tts-close")!);
    expect(tags()).toEqual(["1:next", "2:sent", "3:not_sent", "4:not_sent"]);
  });
  it("the sheet starts from the format (note + shipping fee); editing a price changes the copied message, not the order", async () => {
    DB.s.settings.set("u1", { user_id: "u1", note: "GCash 0917", invoice_shipping_fee: 38 });
    localStorage.setItem("sfl_rd_tt_send_note_u1", "OLD REMEMBERED NOTE");
    await open();
    fireEvent.click(rowOf(2));
    expect((q("tts-shipping") as HTMLInputElement).value).toBe("38");
    expect((q("tts-note") as HTMLTextAreaElement).value).toBe("GCash 0917");
    fireEvent.change(q("tts-price")!, { target: { value: "300" } });
    fireEvent.click(q("tts-copy-open")!); await flush();
    expect(copyText.mock.calls[0][0]).toContain("Total: ₱338");
    expect(localStorage.getItem("sfl_rd_tt_send_note_u1")).toBe("OLD REMEMBERED NOTE");   // Send to TikTok's own note is not touched
    fireEvent.click(q("tts-close")!);
    expect(rowOf(2).querySelector("[data-testid='ivc-row-total']")!.textContent).toBe("₱318");   // the order is unchanged
  });
  it("Skip = Can't message: amber tag, out of Send next, the sheet closes", async () => {
    await open();
    fireEvent.click(rowOf(1));
    expect(q("tts-skip")!.textContent).toBe("Can't message");
    fireEvent.click(q("tts-skip")!); await flush();
    expect(q("tts-sheet")).toBeNull();
    expect(sendsOf()).toEqual(["1:skipped"]);
    expect(rowOf(1).querySelector("[data-testid='ivc-row-tag']")!.textContent).toBe("Can't message");
    expect(q("ivc-send-next")!.textContent).toContain("#2 @ben.t");
    expect(copyText).not.toHaveBeenCalled();
  });
  it("copy refused in the sheet → nothing is marked and the message box is selected", async () => {
    copyText.mockImplementation(async () => false);
    await open();
    fireEvent.click(rowOf(2));
    fireEvent.click(q("tts-copy-open")!); await flush();
    expect(DB.s.sends).toEqual([]);
    expect(q("tts-status")!.textContent).toBe(t.rd_tts_copy_failed);
    const box = q("tts-preview") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    expect(box.selectionEnd).toBe(box.value.length);
    expect(q("tts-copy-open")!.textContent).toBe(t.rd_ivc_send);
  });
  it("a number-only id in the sheet: no link, a copy button", async () => {
    await open();
    fireEvent.click(rowOf(3));
    expect(q("tts-copy-open")).toBeNull();
    fireEvent.click(q("tts-copy-find")!); await flush();
    expect(sendsOf()).toEqual(["3:sent"]);
  });
  it("sending the buyer who is 'being sent' from the sheet settles them (no double mark later)", async () => {
    await open();
    await tapNext();                                     // #1 being sent
    fireEvent.click(rowOf(1));
    fireEvent.click(q("tts-copy-open")!); await flush();
    fireEvent.click(q("tts-close")!);
    expect(tags()).toEqual(["1:sent", "2:next", "3:not_sent", "4:not_sent"]);
    const writes = DB.s.calls.filter((c) => c.op === "upsert").length;
    await tapNext();                                     // opens #2; #1 is not written again
    expect(DB.s.calls.filter((c) => c.op === "upsert").length).toBe(writes);
  });
});

describe("the saved status", () => {
  it("another device (empty phone storage) sees the same status", async () => {
    const r = await open();
    await tapNext(); await tapNext(); await tapNext();   // #1 + #2 sent, #3 being sent on this phone
    fireEvent.click(rowOf(4)); fireEvent.click(q("tts-skip")!); await flush();
    r.unmount();
    localStorage.clear();                                // the other phone
    await open();
    expect(tags()).toEqual(["1:sent", "2:sent", "3:next", "4:skipped"]);
    expect(q("ivc-progress-text")!.textContent).toBe("2 of 4 sent");
  });
  it("what is saved: seller, session, platform, buyer number, a short code, status, a lines code — no name, no username, no message", async () => {
    await open();
    await tapNext(); await tapNext();
    const w = DB.s.calls.find((c) => c.op === "upsert" && c.table === "invoice_sends")!.payload!;
    expect(Object.keys(w).sort()).toEqual(["buyer_key", "buyer_number", "lines_hash", "platform", "session_key", "status", "user_id"]);
    expect(w).toMatchObject({ user_id: "u1", session_key: "S1", platform: "tiktok", buyer_number: 1, buyer_key: buyerKeyOf("@ana"), status: "sent" });
    const all = JSON.stringify(DB.s.calls) + JSON.stringify(DB.s.sends);
    for (const secret of ["ana", "ANA", "ben.t", "A1 dress", "7234567890123456789"]) expect(all).not.toContain(secret);
  });
  it("a new session starts all Not sent", async () => {
    const r = await open();
    await tapNext(); await tapNext();
    r.unmount();
    await open(buyersOf(BASE), { sessionKey: "S2" });
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent", "4:not_sent"]);
    expect(q("ivc-progress-text")!.textContent).toBe("0 of 4 sent");
  });
  it("another seller sees nothing of it", async () => {
    const r = await open();
    await tapNext(); await tapNext();
    r.unmount();
    DB.s.uid = "u2"; localStorage.clear();
    await open(buyersOf(BASE), { sellerId: "u2" });
    expect(tags()).toEqual(["1:next", "2:not_sent", "3:not_sent", "4:not_sent"]);
    expect(DB.s.calls.filter((c) => c.op === "select" && c.table === "invoice_sends").every((c) => typeof c.filters!.user_id === "string")).toBe(true);
  });
  it("the status could not be read → no Send button, a retry; after the retry the list is there", async () => {
    DB.s.failReads = true;
    await open();
    expect(q("ivc-load-error")!.textContent).toContain(t.rd_ivc_load_failed);
    expect(q("ivc-send-next")).toBeNull();
    expect(qa("ivc-row")).toHaveLength(0);
    DB.s.failReads = false;
    fireEvent.click(q("ivc-load-retry")!); await flush();
    expect(qa("ivc-row")).toHaveLength(4);
  });
  it("a mark that could not be saved stays on screen, is counted, and is saved by Try again", async () => {
    await open();
    DB.s.failWrites = true;
    await tapNext(); await tapNext();
    expect(rowOf(1).getAttribute("data-tag")).toBe("sent");
    expect(q("ivc-unsaved")!.textContent).toContain("1 not saved yet");
    expect(DB.s.sends).toEqual([]);
    DB.s.failWrites = false;
    fireEvent.click(q("ivc-unsaved-retry")!); await flush();
    expect(q("ivc-unsaved")).toBeNull();
    expect(sendsOf()).toEqual(["1:sent"]);
  });
  it("nothing with a buyer in it goes to analytics", async () => {
    await open();
    await tapNext(); await tapNext();
    fireEvent.click(rowOf(4)); fireEvent.click(q("tts-skip")!); await flush();
    expect(track.mock.calls.length).toBeGreaterThan(0);
    const sent = JSON.stringify(track.mock.calls);
    for (const secret of ["ana", "ben", "cara", "dress", "7234567890123456789", "₱"]) expect(sent).not.toContain(secret);
  });
});

describe("Format (one for all platforms)", () => {
  it("the sheet: payment note, shipping fee, and a Message type row that cannot be changed", async () => {
    DB.s.settings.set("u1", { user_id: "u1", note: "GCash 0917", invoice_shipping_fee: 38 });
    await open();
    fireEvent.click(q("ivc-format-btn")!);
    expect((q("ivc-format-note") as HTMLTextAreaElement).value).toBe("GCash 0917");
    expect((q("ivc-format-fee") as HTMLInputElement).value).toBe("38");
    expect(q("ivc-format-type")!.textContent).toBe("Message typeText (Picture soon)");
    expect(q("ivc-format-type")!.getAttribute("aria-disabled")).toBe("true");
    expect(q("ivc-format-type")!.querySelector("button, input, select")).toBeNull();
    expect(q("ivc-format-shared")).toBeNull();           // not a Messenger-receipt seller
  });
  it("Save writes ONLY the note and the invoice fee — the Messenger receipt's opening text and QR stay as they are", async () => {
    DB.s.settings.set("u1", { user_id: "u1", note: "old", invoice_shipping_fee: null, opening: "Hello {name}", qr_image: "u1/qr.png" });
    await open();
    fireEvent.click(q("ivc-format-btn")!);
    fireEvent.change(q("ivc-format-note")!, { target: { value: "BDO 1234" } });
    fireEvent.change(q("ivc-format-fee")!, { target: { value: "60" } });
    fireEvent.click(q("ivc-format-save")!); await flush();
    const w = DB.s.calls.find((c) => c.op === "upsert" && c.table === "seller_receipt_settings")!.payload!;
    expect(Object.keys(w).sort()).toEqual(["invoice_shipping_fee", "note", "updated_at", "user_id"]);
    expect(DB.s.settings.get("u1")).toMatchObject({ note: "BDO 1234", invoice_shipping_fee: 60, opening: "Hello {name}", qr_image: "u1/qr.png" });
    fireEvent.click(q("ivc-format-close")!);
    expect(rowOf(2).querySelector("[data-testid='ivc-row-total']")!.textContent).toBe("₱340");   // the list uses the new fee at once
  });
  it("an empty fee is saved as none (no shipping line)", async () => {
    DB.s.settings.set("u1", { user_id: "u1", note: "", invoice_shipping_fee: 38 });
    await open();
    fireEvent.click(q("ivc-format-btn")!);
    fireEvent.change(q("ivc-format-fee")!, { target: { value: "" } });
    fireEvent.click(q("ivc-format-save")!); await flush();
    expect(DB.s.settings.get("u1")!.invoice_shipping_fee).toBeNull();
  });
  it("a failed save says so and keeps what was typed", async () => {
    await open();
    DB.s.failFormatWrite = true;
    fireEvent.click(q("ivc-format-btn")!);
    fireEvent.change(q("ivc-format-note")!, { target: { value: "BDO 1234" } });
    fireEvent.click(q("ivc-format-save")!); await flush();
    expect(q("ivc-format-save")!.textContent).toBe(t.rd_fb_save_failed);
    expect((q("ivc-format-note") as HTMLTextAreaElement).value).toBe("BDO 1234");
    expect(DB.s.settings.get("u1")).toBeUndefined();
  });
  it("the format could not be read → Format is off and nothing can be sent until Try again works", async () => {
    DB.s.failFormatRead = true;
    await open();
    expect(q("ivc-format-error")!.textContent).toContain(t.rd_ivc_fmt_failed);
    expect((q("ivc-format-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(q("ivc-send-next")).toBeNull();
    DB.s.failFormatRead = false;
    fireEvent.click(q("ivc-format-retry")!); await flush();
    expect(q("ivc-send-next")).not.toBeNull();
  });
  it("a seller with the Messenger receipt is told the note is shared", async () => {
    await open(buyersOf(BASE), { onReceiptFormat: () => {} });
    fireEvent.click(q("ivc-format-btn")!);
    expect(q("ivc-format-shared")!.textContent).toBe(t.rd_ivc_fmt_shared);
  });
});

describe("the other tabs", () => {
  it("Instagram and Shopee say Soon and have nothing to send", async () => {
    await open();
    for (const p of ["instagram", "shopee"] as const) {
      fireEvent.click(q(`ivc-tab-${p}`)!);
      expect(q(`ivc-soon-${p}`)).not.toBeNull();
      expect(q(`ivc-soon-badge-${p}`)!.textContent).toBe("Soon");
      expect(q("ivc-tiktok")).toBeNull();
      expect(q("ivc-send-next")).toBeNull();
      expect(q("ivc-receipt-format")).toBeNull();
    }
  });
  it("Facebook says Soon; no Receipt format button for a seller without the Messenger receipt", async () => {
    await open();
    fireEvent.click(q("ivc-tab-facebook")!);
    expect(q("ivc-soon-facebook")!.textContent).toContain(t.rd_ivc_fb_soon);
    expect(q("ivc-receipt-format")).toBeNull();
  });
  it("Facebook, a seller with the Messenger receipt: also a button to the Receipt format screen", async () => {
    const go = vi.fn();
    await open(buyersOf(BASE), { onReceiptFormat: go });
    fireEvent.click(q("ivc-tab-facebook")!);
    fireEvent.click(q("ivc-receipt-format")!);
    expect(go).toHaveBeenCalledTimes(1);
  });
  it("the four tabs are TikTok · Facebook · Instagram · Shopee, TikTok first", async () => {
    await open();
    expect(Array.from(q("ivc-tabs")!.querySelectorAll("[role='tab']")).map((b) => b.textContent)).toEqual(["TikTok", "Facebook", "Instagram", "Shopee"]);
    expect(q("ivc-tab-tiktok")!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("an empty session", () => {
  it("no TikTok buyers → one line, no button", async () => {
    await open(buyersOf([o(5, "Fb Buyer", "FB top", 500, "2026-11-26T05:04:00.000Z", "Facebook")]));
    expect(q("ivc-empty")!.textContent).toBe(t.rd_ivc_empty);
    expect(q("ivc-send-next")).toBeNull();
  });
});
