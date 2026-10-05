// Receipt sheet desktop layout. Pins: the receipt preview pictures (ReceiptSheet + Receipt
// format) carry the no-hover class and are capped at 360px, centered; the sheet is capped at
// 560px, centered, and never scrolls sideways; the Send area (sent time, Send, notes) is
// rendered OUTSIDE the scrolling area, pinned below it, with the safe-area bottom padding.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: null } })),
}));
vi.mock("../../adapters/fbReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbReceipt")>()), fbReceiptInfo: m.info }));
vi.mock("../../adapters/useReceiptPicture", () => ({ useReceiptPicture: () => ({ url: "blob:receipt", failed: false }) }));

import { TProvider } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import ReceiptFormat from "../ReceiptFormat";
import type { BuyerReceipt } from "../../adapters/useReadData";

const SID = "11111111-2222-3333-4444-555555555555";
const receipt: BuyerReceipt = { num: 3, name: "Ann Reyes", handle: "@ann", lines: [{ item: "A1", total: 350 }], count: 1, total: 350, platform: "Facebook" };
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  m.info.mockResolvedValue({ ok: true, canSend: true, sentCount: 1, lastSentAt: new Date().toISOString(), remaining: 1 });
});

describe("ReceiptSheet layout", () => {
  it("the preview picture carries the no-hover class, max 360px, centered", async () => {
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} /></TProvider>);
    await flush();
    const img = q("rs-picture") as HTMLImageElement;
    expect(img.classList.contains("sfl-no-hover")).toBe(true);
    expect(img.style.maxWidth).toBe("360px");
    expect(img.style.margin).toBe("0px auto");
    expect(img.style.display).toBe("block");
  });
  it("the sheet is centered at most 560px wide and never scrolls sideways", async () => {
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} /></TProvider>);
    await flush();
    const sheet = q("receipt-sheet")!;
    expect(sheet.style.maxWidth).toBe("560px");
    expect(sheet.style.width).toBe("100%");
    expect(sheet.style.margin).toBe("0px auto");
    expect(sheet.style.overflow).toBe("hidden");
    expect(q("rs-scroll")!.style.overflowX).toBe("hidden");
    expect(q("rs-footer")!.style.overflowX).toBe("hidden");
  });
  it("Send, the sent time and the notes are outside the scrolling area, in the pinned footer", async () => {
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} /></TProvider>);
    await flush();
    const scroll = q("rs-scroll")!, footer = q("rs-footer")!;
    for (const id of ["rs-send", "rs-sent"]) {
      expect(q(id)).not.toBeNull();
      expect(scroll.contains(q(id))).toBe(false);
      expect(footer.contains(q(id))).toBe(true);
    }
    expect(scroll.style.overflowY).toBe("auto");
    expect(footer.style.flex).toMatch(/^0 0 auto/);
    // jsdom drops calc(env(...)) values, so the safe-area padding is checked in the source.
    const src = readFileSync("src/redesign/components/ReceiptSheet.tsx", "utf8");
    expect(src).toMatch(/data-testid="rs-footer" style=\{\{[^}]*padding: "0 14px calc\(18px \+ env\(safe-area-inset-bottom\)\)"/);
    expect(scroll.contains(q("rs-picture"))).toBe(true);
    expect(scroll.contains(q("rs-opening"))).toBe(true);
  });
  it("a note under Send is in the footer too", async () => {
    m.info.mockResolvedValue({ ok: true, canSend: false, reason: "needs_messaging", sentCount: 0, lastSentAt: null, remaining: 1 });
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} /></TProvider>);
    await flush();
    expect(q("rs-footer")!.contains(q("rs-send-note"))).toBe(true);
  });
});

describe("Receipt format preview", () => {
  it("carries the no-hover class, max 360px, centered", async () => {
    render(<TProvider lang="en"><ReceiptFormat cur="NT$" onBack={vi.fn()} /></TProvider>);
    await flush();
    const img = q("rc-sample-img") as HTMLImageElement;
    expect(img.classList.contains("sfl-no-hover")).toBe(true);
    expect(img.style.maxWidth).toBe("360px");
    expect(img.style.margin).toBe("0px auto");
  });
});

describe("redesign.css", () => {
  const css = readFileSync("src/redesign/redesign.css", "utf8");
  it("the no-hover class cancels the transform and transition; the global image rule is unchanged", () => {
    expect(css).toMatch(/\[data-redesign\] img\.sfl-no-hover,\s*\n\[data-redesign\] img\.sfl-no-hover:hover \{ transition: none; transform: none; \}/);
    expect(css).toContain("[data-redesign] img:hover { transform: scale(1.06) rotate(-2deg); }");
    expect(css).toContain("[data-redesign] img { transition: transform .25s cubic-bezier(.34,1.56,.64,1); }");
  });
});
