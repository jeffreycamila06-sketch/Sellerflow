// Messenger receipt Send — client. The server is mocked (fbReceiptInfo / fbReceiptSend); the
// renderer is mocked so we can see WHAT gets posted. Pins: Send gating by info, a FRESH render
// of the current sheet state is posted, single-flight, the sent state + "Send again", each
// reason, the Orders "Receipt sent ✓" tag, and step-1 behaviour when there is no session.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: null } })),
}));
const m = vi.hoisted(() => ({ info: vi.fn(), send: vi.fn(), render: vi.fn() }));
vi.mock("../../adapters/fbReceipt", async (orig) => ({
  ...(await orig<typeof import("../../adapters/fbReceipt")>()),
  fbReceiptInfo: m.info,
  fbReceiptSend: m.send,
}));
vi.mock("../../adapters/receiptImage", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptImage")>()),
  renderReceiptPng: m.render,
}));

import { TProvider } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import Orders from "../Orders";
import type { BuyerReceipt } from "../../adapters/useReadData";
import type { Buyer } from "../../../lib/orderTypes";

const SID = "11111111-2222-3333-4444-555555555555";
const receipt: BuyerReceipt = { num: 3, name: "Ann Reyes", handle: "@ann", lines: [{ item: "A1", total: 350 }, { item: "100", total: 0 }], count: 2, total: 350, platform: "Facebook" };
const info = (over = {}) => ({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 2, ...over });
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); }; // FileReader resolves on a timer tick
const sheet = (props: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} {...props} /></TProvider>);
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" }));
});

describe("Send gating by /fb/receipt/info", () => {
  it("canSend + remaining > 0 → a primary Send button", async () => {
    m.info.mockResolvedValue(info());
    sheet(); await flush();
    expect(m.info).toHaveBeenCalledWith(SID, 3);
    expect(q("rs-send")!.textContent).toBe("Send to Messenger");
  });
  it("no_access / no_orders → no button and no note (step-1 sheet)", async () => {
    for (const reason of ["no_access", "no_orders"]) {
      m.info.mockResolvedValue(info({ canSend: false, reason, remaining: 0 }));
      const r = sheet(); await flush();
      expect(q("rs-send")).toBeNull();
      expect(q("rs-send-note")).toBeNull();
      expect(q("rs-none-left")).toBeNull();
      r.unmount();
    }
  });
  it("needs_messaging → the re-authorize note, no button", async () => {
    m.info.mockResolvedValue(info({ canSend: false, reason: "needs_messaging" }));
    sheet(); await flush();
    expect(q("rs-send")).toBeNull();
    expect(q("rs-send-note")!.textContent).toContain("authorize your Page again in Facebook channels");
  });
  it("none_left → the one-message-per-comment note, no button", async () => {
    m.info.mockResolvedValue(info({ canSend: false, reason: "none_left", remaining: 0 }));
    sheet(); await flush();
    expect(q("rs-send")).toBeNull();
    expect(q("rs-none-left")!.textContent).toContain("one message per order comment");
  });
  it("info failure → inline note; editing still works", async () => {
    m.info.mockResolvedValue({ ok: false, error: "unreachable" });
    sheet(); await flush();
    expect(q("rs-send-note")!.textContent).toBe("Couldn't check the receipt status.");
    fireEvent.change(document.querySelectorAll("[data-testid='rs-item']")[0], { target: { value: "A1 red" } });
    expect((document.querySelectorAll("[data-testid='rs-item']")[0] as HTMLInputElement).value).toBe("A1 red");
  });
  it("no session id → no info call, no button (step-1 behaviour)", async () => {
    sheet({ sessionId: null }); await flush();
    expect(m.info).not.toHaveBeenCalled();
    expect(q("rs-send")).toBeNull();
  });
});

describe("Send posts a FRESH render of the current sheet", () => {
  it("edits made just before tapping are in the posted picture; the PNG bytes are what is sent", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValue({ ok: true, sentCount: 1, remaining: 1, lastSentAt: "2026-10-05T12:00:00Z" });
    sheet(); await flush();
    fireEvent.change(document.querySelectorAll("[data-testid='rs-price']")[1], { target: { value: "150" } });
    fireEvent.change(q("rs-note") as HTMLTextAreaElement, { target: { value: "GCash only" } });
    m.render.mockClear();
    fireEvent.click(q("rs-send")!);
    await flush();
    expect(m.render).toHaveBeenCalledTimes(1);
    const input = m.render.mock.calls[0][0];
    expect(input.lines).toEqual([{ item: "A1", total: 350 }, { item: "100", total: 150 }]);
    expect(input.note).toBe("GCash only");
    expect(input.buyerNum).toBe(3);
    const [sid, n, b64] = m.send.mock.calls[0];
    expect([sid, n]).toEqual([SID, 3]);
    expect(Buffer.from(b64, "base64")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  });
  it("over 3 MB → a clear note and nothing is posted", async () => {
    m.info.mockResolvedValue(info());
    m.render.mockImplementation(async () => new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: "image/png" }));
    sheet(); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(m.send).not.toHaveBeenCalled();
    expect(q("rs-send-note")!.textContent).toContain("over 3 MB");
  });
});

describe("single-flight + sent state", () => {
  it("double tap → one send; button disabled while sending; then 'Sent ✓' and 'Send again (1 left)'", async () => {
    m.info.mockResolvedValue(info());
    let resolve!: (v: unknown) => void;
    m.send.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const onSent = vi.fn();
    sheet({ onSent }); await flush();
    fireEvent.click(q("rs-send")!);
    fireEvent.click(q("rs-send")!);
    await flush();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect((q("rs-send") as HTMLButtonElement).disabled).toBe(true);
    expect(q("rs-send")!.textContent).toBe("Sending…");
    await act(async () => { resolve({ ok: true, sentCount: 1, remaining: 1, lastSentAt: "2026-10-05T12:00:00Z" }); });
    await flush();
    expect(q("rs-sent")!.textContent).toMatch(/^Sent ✓ /);
    expect(q("rs-send")!.textContent).toBe("Send again (1 left)");
    expect(onSent).toHaveBeenCalledWith(1);
  });
  it("last comment used → no button and the one-message-per-comment note", async () => {
    m.info.mockResolvedValue(info({ remaining: 1 }));
    m.send.mockResolvedValue({ ok: true, sentCount: 1, remaining: 0, lastSentAt: "2026-10-05T12:00:00Z" });
    sheet(); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(q("rs-send")).toBeNull();
    expect(q("rs-none-left")).not.toBeNull();
    expect(q("rs-sent")).not.toBeNull();
  });
  it("unknown_result → 'check Messenger' note and a fresh info read", async () => {
    m.info.mockResolvedValueOnce(info()).mockResolvedValueOnce(info({ remaining: 1 }));
    m.send.mockResolvedValue({ ok: false, error: "unknown_result" });
    sheet(); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(document.querySelector("[role='alert']")!.textContent).toContain("Check Messenger before sending again");
    expect(m.info).toHaveBeenCalledTimes(2);
    expect(q("rs-send")!.textContent).toBe("Send to Messenger");
  });
  it("send_failed → inline note; needs_reauth → re-authorize note and no button", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValueOnce({ ok: false, error: "send_failed", code: 10 });
    sheet(); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(document.querySelector("[role='alert']")!.textContent).toBe("Couldn't send the receipt. Try again.");
    m.send.mockResolvedValueOnce({ ok: false, error: "needs_reauth", code: 190 });
    fireEvent.click(q("rs-send")!); await flush();
    expect(q("rs-send")).toBeNull();
    expect(document.querySelector("[role='alert']")!.textContent).toContain("authorize your Page again");
  });
});

describe("Orders 'Receipt sent ✓' tag", () => {
  const buyer = (platform: string): Buyer => ({ handle: "@ann", name: "Ann Reyes", platform, num: 3, totalSpent: 350, totalOrders: 1, orders: [{ item: "A1", total: 350 }] as never });
  const renderOrders = (b: Buyer, extra: Record<string, unknown>) => {
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[b]} {...extra} /></TProvider>);
    fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } });
    return r;
  };
  it("Facebook buyer + preview + session → ONE info call; tag when sentCount > 0", async () => {
    m.info.mockResolvedValue(info({ sentCount: 1 }));
    const { container } = renderOrders(buyer("Facebook"), { fbReceipt: true, sessionId: SID });
    await flush();
    expect(m.info).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='receipt-sent-tag']")!.textContent).toBe("Receipt sent ✓");
  });
  it("sentCount 0 → no tag", async () => {
    m.info.mockResolvedValue(info({ sentCount: 0 }));
    const { container } = renderOrders(buyer("Facebook"), { fbReceipt: true, sessionId: SID });
    await flush();
    expect(container.querySelector("[data-testid='receipt-sent-tag']")).toBeNull();
  });
  it("non-preview, TikTok/Shopee, or no session → no call, no tag", async () => {
    for (const [b, extra] of [[buyer("Facebook"), { sessionId: SID }], [buyer("TikTok"), { fbReceipt: true, sessionId: SID }], [buyer("Shopee"), { fbReceipt: true, sessionId: SID }], [buyer("Facebook"), { fbReceipt: true }]] as const) {
      const r = renderOrders(b, extra); await flush();
      expect(r.container.querySelector("[data-testid='receipt-sent-tag']")).toBeNull();
      r.unmount();
    }
    expect(m.info).not.toHaveBeenCalled();
  });
});
