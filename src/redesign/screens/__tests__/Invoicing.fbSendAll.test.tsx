// FB-2 — Invoicing → Facebook "Send all in Messenger" (components/FbSendAllTab.tsx) with a fake server for
// /fb/sendall/{status,start,preview} and the in-memory Invoicing tables (invoice_sends / invoice_line_cancels,
// platform "facebook"). Pins: the list (name, pieces, total, tag per buyer), the tags and their words in 8
// languages, "Send all · K left" (a double tap = one start), the button while a job runs and the status read
// again until it ends (then no more reads), a row's Send, the "Other chat app" note + How steps, ✎ View =
// the receipt editor (Invoicing.fbEdit.test.tsx has the editor itself) with Send to #N / I sent it by hand /
// Buyer cancelled, a server that says "not open
// for you" → the Facebook tab as before, and nothing of TikTok's saved status touched.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});

import { TProvider, buildT, tpl } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { FB_POLL_MS } from "../../adapters/fbSendAll";
import { buyerKeyOf } from "../../adapters/invoicing";
import { _resetReceiptEditSaves } from "../../adapters/fbReceiptEdit";

const SID = "11111111-2222-3333-4444-555555555555";
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => [...document.querySelectorAll(`[data-testid='${id}']`)] as HTMLElement[];
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const fb = (n: number, name: string, product: string, price: number, min = n) =>
  ({ buyer_number: n, handle: name, customer_name: name, platform: "Facebook", product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
const tt = (n: number, h: string) => ({ buyer_number: n, handle: h, customer_name: h, platform: "TikTok", product: "T", price: 10, created_at: `2026-11-26T04:0${n}:00.000Z`, session_date: "2026-11-26" });

type ServerBuyer = { n: number; tag: string; at?: string };
const S = {
  status: { ok: true, access: true, allowed: true, job: null as unknown, needsMessaging: false, buyers: [] as ServerBuyer[] },
  calls: [] as { path: string; body: Record<string, unknown> }[],
  startAnswer: { ok: true, already: false } as Record<string, unknown>,
  startStatus: 200,
  previewOk: true,
};
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  S.calls.push({ path, body });
  const json = path === "/fb/sendall/status" ? S.status
    : path === "/fb/sendall/start" ? S.startAnswer
    : path === "/fb/sendall/preview" ? (S.previewOk ? { ok: true, png: "iVBORw0KGgo=" } : { ok: false, error: "draw_failed" })
    : { ok: false };
  return { status: path === "/fb/sendall/start" ? S.startStatus : 200, json: async () => json } as unknown as Response;
});
const callsTo = (p: string) => S.calls.filter((c) => c.path === `/fb/sendall/${p}`);

function buyers() {
  return rebuildSessionFromRows([tt(1, "@tik"), fb(2, "Ana Cruz", "Dress", 350), fb(2, "Ana Cruz", "Belt", 50, 7), fb(3, "Ben Lee", "Top", 280), fb(4, "Cy", "Bag", 500), fb(5, "Dee", "Hat", 90)]).buyers;
}
async function open(lang: (typeof LANGS)[number] = "en", extra: Record<string, unknown> = {}) {
  render(
    <TProvider lang={lang}>
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey={SID} sessionId={SID} sellerId="u1" todayId="2026-11-26" tapGuardMs={0}
          onReceiptFormat={() => {}} fbSendAll={{ lang }} {...extra} />
      </div>
    </TProvider>,
  );
  await flush();
  fireEvent.click(q("ivc-tab-facebook")!);
  await flush();
}
const rowOf = (n: number) => qa("ivc-fb-row").find((r) => r.getAttribute("data-buyer") === String(n))!;
const tagOfRow = (n: number) => rowOf(n).getAttribute("data-tag");

beforeEach(() => {
  _resetReceiptEditSaves();
  DB.reset(); localStorage.clear();
  S.status = { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [{ n: 2, tag: "not_sent" }, { n: 3, tag: "sent", at: "2026-11-26T06:05:00.000Z" }, { n: 4, tag: "other_app" }, { n: 5, tag: "cant_message" }] };
  S.calls = []; S.startAnswer = { ok: true, already: false }; S.startStatus = 200; S.previewOk = true;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the list", () => {
  it("one row per Facebook buyer (TikTok buyers are not here): #, name, pieces, total, tag; summary + progress", async () => {
    await open();
    expect(qa("ivc-fb-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["2", "3", "4", "5"]);
    const r2 = rowOf(2);
    expect(r2.querySelector("[data-testid='ivc-fb-row-name']")!.textContent).toBe("Ana Cruz");
    expect(r2.querySelector("[data-testid='ivc-fb-row-pcs']")!.textContent).toBe("· 2 pcs");
    expect(r2.querySelector("[data-testid='ivc-fb-row-total']")!.textContent).toBe("₱400");
    expect(q("ivc-fb-summary-line")!.textContent).toBe("4 Facebook buyers · ₱1,270");
    expect(q("ivc-fb-progress-text")!.textContent).toBe("1 of 4 sent");
    expect(callsTo("status")).toEqual([{ path: "/fb/sendall/status", body: { sessionId: SID } }]);
  });
  it("tags: Not sent · Sent hh:mm · Other chat app · Can't message (the server's), Cancelled · Sent by hand (the seller's)", async () => {
    DB.s.sends.push({ user_id: "u1", session_key: SID, platform: "facebook", buyer_number: 5, buyer_key: buyerKeyOf("Dee"), status: "sent", sent_at: "2026-11-26T06:00:00Z", lines_hash: "x" });
    S.status.buyers.push({ n: 6, tag: "unknown" });
    await open();
    expect(["2", "3", "4", "5"].map((n) => tagOfRow(Number(n)))).toEqual(["not_sent", "sent", "other_app", "by_hand"]);
    const words = qa("ivc-fb-row-tag").map((e) => e.textContent);
    expect(words[0]).toBe("Not sent");
    expect(words[1]).toMatch(/^✓ Sent \d{1,2}:\d{2}/);
    expect(words[2]).toBe("Other chat app");
    expect(words[3]).toBe("Sent by hand");
    expect(q("ivc-fb-progress-text")!.textContent).toBe("2 of 4 sent");
  });
  it("the TikTok tab's saved status is not read with the Facebook one (each platform its own)", async () => {
    await open();
    const reads = DB.s.calls.filter((c) => c.table === "invoice_sends" && c.op === "select").map((c) => c.filters?.platform);
    expect(reads).toContain("facebook");
    expect(reads).toContain("tiktok");    // the TikTok tab read its own when the screen opened, as before
  });
});

describe("Send all", () => {
  it("'Send all in Messenger · K left' (K = Not sent + Other chat app) and the hint line; ONE start for a double tap", async () => {
    await open();
    expect(q("ivc-fb-send-all")!.textContent).toBe("Send all in Messenger · 2 left");
    expect(q("ivc-fb-hint")!.textContent).toBe("Each buyer gets their receipt picture in Messenger, one by one. You can close the app — sending continues.");
    fireEvent.click(q("ivc-fb-send-all")!);
    fireEvent.click(q("ivc-fb-send-all")!);
    await flush();
    expect(callsTo("start")).toEqual([{ path: "/fb/sendall/start", body: { sessionId: SID, lang: "en", currency: "₱" } }]);
    expect(callsTo("status").length).toBeGreaterThanOrEqual(2);        // read again right after the tap
  });
  it("while a job runs: the button shows the progress and the status is read every few seconds; it stops when the job ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    S.status.job = { state: "running", oneBuyer: false, total: 4, sent: 1, skipped: 0, failed: 0, stop: null, startedAt: "x", finishedAt: null };
    S.status.buyers = [{ n: 2, tag: "sending" }, { n: 3, tag: "sent", at: "2026-11-26T06:05:00.000Z" }, { n: 4, tag: "sending" }, { n: 5, tag: "cant_message" }];
    await open();
    expect(q("ivc-fb-sending")!.textContent).toBe("Sending in Messenger… 1 of 4");
    expect(q("ivc-fb-send-all")).toBeNull();
    expect(qa("ivc-fb-row-send")).toHaveLength(0);                     // no row Send while a job runs
    expect(tagOfRow(2)).toBe("sending");
    const before = callsTo("status").length;
    await act(async () => { vi.advanceTimersByTime(FB_POLL_MS); }); await flush();
    expect(callsTo("status").length).toBe(before + 1);
    S.status.job = { state: "done", oneBuyer: false, total: 4, sent: 2, skipped: 1, failed: 1, stop: null, startedAt: "x", finishedAt: "y" };
    S.status.buyers = [{ n: 2, tag: "sent", at: "2026-11-26T06:09:00.000Z" }, { n: 3, tag: "sent", at: "2026-11-26T06:05:00.000Z" }, { n: 4, tag: "other_app" }, { n: 5, tag: "cant_message" }];
    await act(async () => { vi.advanceTimersByTime(FB_POLL_MS); }); await flush();
    const after = callsTo("status").length;
    await act(async () => { vi.advanceTimersByTime(FB_POLL_MS * 5); }); await flush();
    expect(callsTo("status").length).toBe(after);                       // job done → no more reads
    expect(q("ivc-fb-send-all")!.textContent).toBe("Send all in Messenger · 1 left");
  });
  it("closing the screen stops the reads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    S.status.job = { state: "queued", oneBuyer: false, total: 0, sent: 0, skipped: 0, failed: 0, stop: null, startedAt: "x", finishedAt: null };
    await open();
    const n = callsTo("status").length;
    cleanup();
    await act(async () => { vi.advanceTimersByTime(FB_POLL_MS * 4); });
    expect(callsTo("status").length).toBe(n);
  });
  it("a start the server refuses shows one line; nothing marked", async () => {
    S.startStatus = 500; S.startAnswer = { ok: false, error: "E0" };
    await open();
    fireEvent.click(q("ivc-fb-send-all")!); await flush();
    expect(q("ivc-fb-start-error")!.textContent).toBe("Couldn't start sending. Try again.");
    expect(DB.s.sends).toEqual([]);
  });
  it("a row's Send = a job for that buyer only; only on Not sent / Other chat app rows", async () => {
    await open();
    expect(qa("ivc-fb-row-send").map((b) => b.closest("[data-testid='ivc-fb-row']")!.getAttribute("data-buyer"))).toEqual(["2", "4"]);
    fireEvent.click(rowOf(4).querySelector("[data-testid='ivc-fb-row-send']")!); await flush();
    expect(callsTo("start")).toEqual([{ path: "/fb/sendall/start", body: { sessionId: SID, buyerNumber: 4, lang: "en", currency: "₱" } }]);
    expect(q("ivc-fb-sheet")).toBeNull();            // the row's Send does not open the sheet
  });
  it("everyone sent → 'All invoices sent.' and no Send all button", async () => {
    S.status.buyers = [2, 3, 4, 5].map((n) => ({ n, tag: "sent", at: "2026-11-26T06:05:00.000Z" }));
    await open();
    expect(q("ivc-fb-send-all")).toBeNull();
    expect(q("ivc-fb-finished")!.textContent).toBe("✓ All invoices sent.");
  });
  it("a Page that cannot message: the note, and the button is off", async () => {
    S.status.needsMessaging = true;
    await open();
    expect(q("ivc-fb-stop")!.textContent).toBe(buildT("en").rd_rs_needs_messaging);
    expect((q("ivc-fb-send-all") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Other chat app", () => {
  it("an amber note with How → the help steps (Conversation routing, turn off the other app, Send again)", async () => {
    await open();
    expect(q("ivc-fb-other-note")!.textContent).toContain("another chat app is handling those buyers' Messenger chats");
    fireEvent.click(q("ivc-fb-how")!);
    const steps = q("ivc-fb-how-steps")!.textContent!;
    expect(steps).toContain("Conversation routing");
    expect(steps).toContain("choose SellerFlowLive");
    expect(steps).toContain("Turn off or remove any other app");
    expect(steps).toContain("tap Send again");
    fireEvent.click(q("ivc-fb-how-close")!);
    expect(q("ivc-fb-how-sheet")).toBeNull();
  });
  it("no buyer refused that way → no note", async () => {
    S.status.buyers = [{ n: 2, tag: "not_sent" }];
    await open();
    expect(q("ivc-fb-other-note")).toBeNull();
  });
});

describe("✎ View", () => {
  it("✎ View = the receipt editor of that buyer (no server picture any more), Send to #N in Messenger", async () => {
    await open();
    fireEvent.click(rowOf(2).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();
    expect(callsTo("preview")).toEqual([]);   // the picture is drawn on the phone from the same input as the server
    const sheet = q("ivc-fb-sheet")!;
    expect([...sheet.querySelectorAll<HTMLInputElement>("[data-testid='rs-item']")].map((i) => i.value)).toEqual(["Dress", "Belt"]);
    expect(sheet.querySelector("[data-testid='rs-opening']")).not.toBeNull();
    expect(q("ivc-fb-sheet-send")!.textContent).toBe("Send to #2 in Messenger");
    fireEvent.click(q("ivc-fb-sheet-send")!); await flush();
    expect(callsTo("start").at(-1)!.body).toEqual({ sessionId: SID, buyerNumber: 2, lang: "en", currency: "₱" });
  });
  it("I sent it by hand: ONLY after Messenger could not send (with its line) → saved Sent (platform facebook) → 'Sent by hand'", async () => {
    await open();
    fireEvent.click(rowOf(2).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();   // not sent yet
    expect(q("ivc-fb-sheet-send")).not.toBeNull();
    expect(q("ivc-fb-sheet-cancel")).not.toBeNull();
    expect(q("ivc-fb-sheet-hand")).toBeNull();
    expect(q("ivc-fb-hand-note")).toBeNull();
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    for (const n of [4, 5]) {                                   // "another app" / can't message: failed sends
      fireEvent.click(rowOf(n).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();
      expect(q("ivc-fb-hand-note")!.textContent).toBe(buildT("en").rd_ivc_fb_hand_note);
      expect(q("ivc-fb-sheet-hand")).not.toBeNull();
      expect(q("ivc-fb-sheet-cancel")).not.toBeNull();
      fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    }
    fireEvent.click(rowOf(4).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();
    expect(q("ivc-fb-sheet-send")).not.toBeNull();              // Send again is still there
    fireEvent.click(q("ivc-fb-sheet-hand")!); await flush();
    expect(DB.s.sends).toEqual([expect.objectContaining({ platform: "facebook", buyer_number: 4, status: "sent" })]);
    expect(tagOfRow(4)).toBe("by_hand");
    expect(q("ivc-fb-sheet")).toBeNull();
    expect(qa("ivc-fb-row-send").map((b) => b.closest("[data-testid='ivc-fb-row']")!.getAttribute("data-buyer"))).toEqual(["2"]); // Send all skips it
  });
  it("Buyer cancelled → Cancelled (dimmed, out of 'X of N' and K), Undo cancel → back", async () => {
    await open();
    fireEvent.click(rowOf(4).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();
    fireEvent.click(q("ivc-fb-sheet-cancel")!); await flush();
    expect(tagOfRow(4)).toBe("cancelled");
    expect(q("ivc-fb-progress-text")!.textContent).toBe("1 of 3 sent");
    expect(q("ivc-fb-send-all")!.textContent).toBe("Send all in Messenger · 1 left");
    expect(qa("ivc-fb-row-send")).toHaveLength(1);
    fireEvent.click(rowOf(4)); await flush();
    expect(q("ivc-fb-sheet-send")).toBeNull();
    fireEvent.click(q("ivc-fb-undo-cancel")!); await flush();
    expect(tagOfRow(4)).toBe("other_app");
  });
  it("the receipt format could not be read → a line + Try again (no editor, nothing saved)", async () => {
    DB.s.failFormatRead = true;
    await open();
    fireEvent.click(rowOf(2)); await flush();
    expect(q("ivc-fb-edit-error")).not.toBeNull();
    expect(q("ivc-fb-editor")).toBeNull();
    DB.s.failFormatRead = false;
    fireEvent.click(q("ivc-fb-edit-retry")!); await flush();
    expect(q("ivc-fb-editor")).not.toBeNull();
    expect(DB.s.edits).toEqual([]);
  });
  it("a sent buyer: no Send, no 'by hand'; Buyer cancelled stays", async () => {
    await open();
    fireEvent.click(rowOf(3)); await flush();
    expect(q("ivc-fb-sheet-send")).toBeNull();
    expect(q("ivc-fb-sheet-hand")).toBeNull();
    expect(q("ivc-fb-sheet-cancel")).not.toBeNull();
  });
});

describe("who sees it", () => {
  it("the server says not open for this seller → the Facebook tab exactly as before (Soon + Receipt format)", async () => {
    S.status = { ok: true, access: true, allowed: false, job: null, needsMessaging: false, buyers: [] } as never;
    await open();
    expect(q("ivc-fb")).toBeNull();
    expect(q("ivc-soon-facebook")).not.toBeNull();
    expect(q("ivc-receipt-format")).not.toBeNull();
    S.status = { ok: true, access: false } as never;
    cleanup(); await open();
    expect(q("ivc-soon-facebook")).not.toBeNull();
  });
  it("without the fbSendAll prop (switch off, not admin) → today's card, no Send all read at all", async () => {
    await open("en", { fbSendAll: undefined });
    expect(q("ivc-fb")).toBeNull();
    expect(q("ivc-soon-facebook")).not.toBeNull();
    expect(S.calls).toEqual([]);
  });
  it("a session without a session id → one line, nothing asked of the server", async () => {
    render(<TProvider lang="en"><div data-redesign=""><Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey="day:2026-11-26" sessionId={null} sellerId="u1" todayId="2026-11-26" tapGuardMs={0} onReceiptFormat={() => {}} fbSendAll={{ lang: "en" }} /></div></TProvider>);
    await flush();
    fireEvent.click(q("ivc-tab-facebook")!); await flush();
    expect(q("ivc-fb-old")!.textContent).toBe("This session can't be sent from here. Send its receipts from Orders.");
    expect(S.calls).toEqual([]);
  });
});

describe("8 languages", () => {
  it("every new text is filled, the picture language = the app's, no price / plan words", async () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      for (const k of ["rd_ivc_fb_summary", "rd_ivc_fb_send_all", "rd_ivc_fb_sending_all", "rd_ivc_fb_all_hint", "rd_ivc_fb_t_other", "rd_ivc_fb_t_hand", "rd_ivc_fb_send", "rd_ivc_fb_other_note", "rd_ivc_fb_how", "rd_ivc_fb_how_title", "rd_ivc_fb_how_steps", "rd_ivc_fb_view_send", "rd_ivc_fb_view_note", "rd_ivc_fb_pic_failed", "rd_ivc_fb_start_failed",
        "rd_ivc_fb_edit_hint", "rd_ivc_fb_edited", "rd_ivc_fb_edited_new", "rd_ivc_fb_edit_new_note", "rd_ivc_fb_reset", "rd_ivc_fb_reset_q", "rd_ivc_fb_reset_yes", "rd_ivc_fb_reset_no", "rd_ivc_fb_old", "rd_ivc_fb_empty", "rd_ivc_fb_empty_past", "rd_ivc_fb_stopped"] as const) {
        expect(String(t[k]).trim(), `${lang} ${k}`).not.toBe("");
      }
      expect(t.rd_ivc_fb_send_all).toContain("{k}");
      expect(t.rd_ivc_fb_view_send).toContain("#{n}");
      await open(lang);
      expect(q("ivc-fb-send-all")!.textContent).toBe(tpl(t.rd_ivc_fb_send_all, { k: 2 }));
      fireEvent.click(rowOf(2).querySelector("[data-testid='ivc-fb-row-view']")!); await flush();
      expect(q("ivc-fb-edit-hint")!.textContent).toBe(t.rd_ivc_fb_edit_hint);
      const text = document.querySelector("[data-testid='ivc-fb']")!.textContent + q("ivc-fb-sheet")!.textContent!;
      expect(text, lang).not.toMatch(/upgrade|subscri|NT\$\d|price/i);
      cleanup(); S.calls = [];
    }
  });
});
