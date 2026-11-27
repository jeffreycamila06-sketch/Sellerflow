// Orders → Messenger receipt sheet (components/ReceiptSheet.tsx) = main e9a64019, after its editor fields were
// moved into components/ReceiptEditorFields.tsx (shared with Invoicing → Facebook). For a set of real taps the
// sheet's whole DOM, every picture input and every Send call must equal what main produced
// (fixtures/receiptSheet.main.json, taken on e9a64019 with SFL_RS_DUMP=<file>).
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ info: vi.fn(), send: vi.fn(), render: vi.fn(), settings: vi.fn() }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  loadReceiptSettings: m.settings,
}));
vi.mock("../../adapters/fbReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbReceipt")>()), fbReceiptInfo: m.info, fbReceiptSend: m.send }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import type { BuyerReceipt } from "../../adapters/useReadData";

const SID = "11111111-2222-3333-4444-555555555555";
const receipt: BuyerReceipt = { num: 3, name: "Ann", handle: "@ann", lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }, { item: "", total: 0 }], count: 3, total: 630, platform: "Facebook" };
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 420)); }); };
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement;
const all = (id: string) => [...document.querySelectorAll(`[data-testid='${id}']`)] as HTMLInputElement[];
const dom = () => (document.querySelector("[data-testid='receipt-sheet-overlay']")?.outerHTML ?? "").replace(/blob:[^"]+/g, "blob:X");

const FIX = resolve(__dirname, "fixtures/receiptSheet.main.json");
const DUMP = process.env.SFL_RS_DUMP || "";
const want: Record<string, unknown> = !DUMP && existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")).cases : {};
const got: Record<string, unknown> = {};
afterAll(() => { if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "ReceiptSheet DOM + picture inputs + Send calls, taken on main e9a64019. ReceiptSheet.sameAsMain.test.tsx", cases: got }, null, 1) + "\n"); });
// The sheet prints the send time ("Sent ✓ 12:00 PM") in the phone's own time zone: the fixture was taken in UTC,
// so the zone is pinned here (same as printerTesterAllModels) — else it fails on a Taipei / Manila machine.
let tz: string | undefined;
beforeAll(() => { tz = process.env.TZ; process.env.TZ = "UTC"; }); // Node re-reads TZ when it changes
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
const check = (name: string, v: unknown) => { got[name] = v; if (!DUMP) expect(v).toEqual(want[name]); };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  m.settings.mockResolvedValue({ ok: true, settings: { opening: "Hi", note: "Pay", qrImage: "data:image/png;base64,iVBORw0KGgo=" } });
  m.info.mockResolvedValue({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 2 });
  m.send.mockResolvedValue({ ok: true, sentCount: 1, remaining: 1, lastSentAt: "2026-10-05T12:00:00Z" });
});
const open = (props: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} {...props} /></TProvider>);

describe("ReceiptSheet = main", () => {
  it("opened: DOM + picture input", async () => {
    open(); await settle();
    check("open.dom", dom()); check("open.input", m.render.mock.calls.at(-1)?.[0]);
  });
  it("every field edited, a line added and one removed, then Send", async () => {
    open(); await settle();
    fireEvent.change(q("rs-opening"), { target: { value: "Hello there" } });
    fireEvent.change(all("rs-item")[0], { target: { value: "A1 dress" } });
    fireEvent.change(all("rs-price")[1], { target: { value: "300" } });
    fireEvent.click(all("rs-remove-line")[2]);
    fireEvent.click(q("rs-add-line"));
    fireEvent.change(all("rs-item")[2], { target: { value: "C3" } });
    fireEvent.change(all("rs-price")[2], { target: { value: "99" } });
    fireEvent.change(q("rs-shipping"), { target: { value: "60" } });
    fireEvent.change(q("rs-note"), { target: { value: "Bank 123" } });
    await settle();
    check("edited.dom", dom()); check("edited.input", m.render.mock.calls.at(-1)?.[0]);
    fireEvent.click(q("rs-send")); await settle();
    check("sent.dom", dom()); check("sent.call", m.send.mock.calls.at(-1)?.slice(0, 2)); check("sent.input", m.render.mock.calls.at(-1)?.[0]);
  });
  it("polish: sent before → Send again asks first", async () => {
    m.info.mockResolvedValue({ ok: true, canSend: true, sentCount: 1, lastSentAt: "2026-10-05T11:00:00Z", remaining: 1 });
    open({ polish: true }); await settle();
    fireEvent.click(q("rs-send")); await settle();
    check("again.dom", dom());
  });
  it("no QR, every line emptied, no session id", async () => {
    m.settings.mockResolvedValue({ ok: true, settings: { opening: "", note: "", qrImage: null } });
    open({ sessionId: null }); await settle();
    for (const el of all("rs-item")) fireEvent.change(el, { target: { value: "" } });
    await settle();
    check("empty.dom", dom()); check("empty.input", m.render.mock.calls.at(-1)?.[0]);
  });
  it("the fixture covers every case", () => { if (!DUMP) expect(Object.keys(want).sort()).toEqual(["again.dom", "edited.dom", "edited.input", "empty.dom", "empty.input", "open.dom", "open.input", "sent.call", "sent.dom", "sent.input"]); });
});
