// "Format follows the tab" must not change what is SENT. For the same saved settings (note, shipping fee,
// opening, QR) these must equal what main b6d5d417 produced (fixtures/formatPerTab.main.json, taken on main
// with SFL_FPT_DUMP=<file>): the TikTok message Send next copies, the Facebook ✎ View picture input, the
// Send all start request, the Orders Messenger receipt picture input, and the Receipt format screen (its whole
// DOM + its sample picture input — its QR picker and sample were moved into components/ReceiptFormatParts.tsx).
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const m = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider } from "../../i18n";
import Invoicing from "../Invoicing";
import ReceiptFormat from "../ReceiptFormat";
import ReceiptSheet from "../../components/ReceiptSheet";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";

const SID = "11111111-2222-3333-4444-555555555555";
const QR = "data:image/png;base64,iVBORw0KGgo=";
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
// React runs effects when act() ends, so the picture's 350 ms timer starts only then: wait in several steps
const settle = async () => { for (let i = 0; i < 4; i++) await wait(400); };
const row = (n: number, handle: string, name: string, platform: string, product: string, price: number, min: number) =>
  ({ buyer_number: n, handle, customer_name: name, platform, product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
const ROWS = [
  row(1, "@ana", "ANA", "TikTok", "A1 dress", 350, 1), row(1, "@ana", "ANA", "TikTok", "C3 bag", 120, 2),
  row(2, "Ana Cruz", "Ana Cruz", "Facebook", "Dress", 350, 3), row(2, "Ana Cruz", "Ana Cruz", "Facebook", "Belt", 50, 4),
];
const buyers = () => rebuildSessionFromRows(ROWS as never).buyers;
const calls: { path: string; body: Record<string, unknown> }[] = [];
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body || "{}");
  calls.push({ path, body });
  const json = path === "/fb/sendall/status" ? { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [{ n: 2, tag: "not_sent" }] }
    : path === "/fb/sendall/start" ? { ok: true, already: false } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});
const dom = (id: string) => (q(id)?.outerHTML ?? "").replace(/blob:[^"]+/g, "blob:X");

const FIX = resolve(__dirname, "fixtures/formatPerTab.main.json");
const DUMP = process.env.SFL_FPT_DUMP || "";
const want: Record<string, unknown> = !DUMP && existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")).cases : {};
const got: Record<string, unknown> = {};
afterAll(() => { if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "What is sent for the same saved settings, taken on main b6d5d417. formatPerTab.sameAsMain.test.tsx", cases: got }, null, 1) + "\n"); });
const check = (name: string, v: unknown) => { got[name] = v; if (!DUMP) expect(v).toEqual(want[name]); };

// the Orders sheet prints a send time in local time — pin the zone (as in ReceiptSheet.sameAsMain)
let tz: string | undefined;
beforeEach(() => {
  tz = process.env.TZ; process.env.TZ = "UTC";
  DB.reset(); localStorage.clear(); calls.length = 0;
  DB.s.settings.set("u1", { user_id: "u1", opening: "Hi {name}!", note: "Pay by GCash 0917", qr_image: QR, invoice_shipping_fee: 60 });
  copyText.mockReset(); copyText.mockImplementation(async () => true);
  m.render.mockReset();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

const invoicing = (fbProps: boolean) => render(
  <TProvider lang="en"><div data-redesign="">
    <Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey={SID} sessionId={SID} sellerId="u1" todayId="2026-11-26" tapGuardMs={0}
      sessionStartedAt="2026-11-26T04:00:00.000Z" sessionWindowDays={1}
      {...(fbProps ? { onReceiptFormat: () => {}, fbSendAll: { lang: "en" } } : {})} />
  </div></TProvider>,
);

describe("what is sent = main, for the same saved settings", () => {
  it("TikTok: the message Send next copies (with and without the Receipt add-on)", async () => {
    for (const fbProps of [false, true]) {
      invoicing(fbProps); await flush();
      fireEvent.click(q("ivc-send-next")!); await flush();
      check(`tiktok.message.${fbProps}`, copyText.mock.calls.at(-1)?.[0]);
      cleanup(); copyText.mockClear(); DB.s.sends = []; localStorage.clear();
    }
  });
  it("Facebook: the ✎ View picture input and the Send all start request", async () => {
    invoicing(true); await flush();
    fireEvent.click(q("ivc-tab-facebook")!); await flush();
    fireEvent.click(document.querySelector("[data-testid='ivc-fb-row'] [data-testid='ivc-fb-row-view']")!); await settle();
    check("fb.view.input", m.render.mock.calls.at(-1)?.[0]);
    cleanup();
    invoicing(true); await flush();
    fireEvent.click(q("ivc-tab-facebook")!); await flush();
    fireEvent.click(q("ivc-fb-send-all")!); await flush();
    const yes = q("ivc-fb-send-all-yes"); if (yes) { fireEvent.click(yes); await flush(); }
    check("fb.sendall.start", calls.filter((c) => c.path === "/fb/sendall/start").map((c) => c.body));
  });
  it("settings typed into the NEW Facebook receipt format sheet → the same TikTok message, ✎ View picture and Orders input as main", async () => {
    if (DUMP) return;   // nothing to record: this compares with the cases above
    DB.s.settings.set("u1", { user_id: "u1" });
    invoicing(true); await flush();
    fireEvent.click(q("ivc-tab-facebook")!); await flush();
    fireEvent.click(q("ivc-format-btn")!); await flush();
    const file = new File([new Uint8Array([1])], "qr.png", { type: "image/png" });
    const rs = await import("../../adapters/receiptSettings");
    const spy = vi.spyOn(rs, "downscaleQrFile").mockResolvedValue(QR);
    fireEvent.change(q("ivc-fbformat-opening")!, { target: { value: "Hi {name}!" } });
    fireEvent.change(q("ivc-fbformat-note")!, { target: { value: "Pay by GCash 0917" } });
    fireEvent.change(q("ivc-fbformat-fee")!, { target: { value: "60" } });
    fireEvent.change(q("ivc-fbformat-qr-file")!, { target: { files: [file] } }); await flush();
    fireEvent.click(q("ivc-fbformat-save")!); await flush();
    spy.mockRestore();
    expect(DB.s.settings.get("u1")).toMatchObject({ opening: "Hi {name}!", note: "Pay by GCash 0917", qr_image: QR, invoice_shipping_fee: 60 });
    fireEvent.click(q("ivc-fbformat-close")!); await flush();
    fireEvent.click(q("ivc-fb-row-view")!); await settle();
    expect(m.render.mock.calls.at(-1)?.[0]).toEqual(want["fb.view.input"]);
    cleanup(); DB.s.sends = []; localStorage.clear();
    invoicing(true); await flush();
    fireEvent.click(q("ivc-send-next")!); await flush();
    expect(copyText.mock.calls.at(-1)?.[0]).toEqual(want["tiktok.message.true"]);
  });
  it("Orders: the Messenger receipt picture input", async () => {
    const b = buyers().find((x) => x.platform === "Facebook")!;
    const receipt = { num: b.bNum, name: "Ana Cruz", handle: "Ana Cruz", lines: [{ item: "Dress", total: 350 }, { item: "Belt", total: 50 }], count: 2, total: 400, platform: "Facebook" };
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt as never} cur="₱" onClose={() => {}} sessionId={SID} /></TProvider>);
    await settle();
    check("orders.input", m.render.mock.calls.at(-1)?.[0]);
  });
  it("the Receipt format screen: whole DOM and its sample picture input; QR remove keeps the same DOM", async () => {
    render(<TProvider lang="en"><div data-redesign=""><ReceiptFormat cur="₱" onBack={() => {}} /></div></TProvider>);
    await settle();
    check("rf.dom", dom("receipt-format"));
    check("rf.sample", m.render.mock.calls.at(-1)?.[0]);
    fireEvent.click(q("rc-qr-remove")!); await settle();
    check("rf.dom.noqr", dom("receipt-format"));
    check("rf.sample.noqr", m.render.mock.calls.at(-1)?.[0]);
    fireEvent.click(q("rc-save")!); await flush();
    check("rf.save", DB.s.calls.filter((c) => c.op === "upsert").map((c) => { const p = { ...c.payload }; delete p.updated_at; return p; }));
  });
});
