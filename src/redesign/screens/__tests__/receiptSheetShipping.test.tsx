// Orders → Receipt sheet: the Shipping fee box (after "+ Add line", empty on every open, never
// saved) goes into the picture input; the Payment QR is shown read-only under the note in a
// 160 × 160 white box (contain, never cropped), or a muted line when none is saved.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { ReceiptInput } from "../../adapters/receiptImage";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ info: vi.fn(), qr: null as string | null, last: null as ReceiptInput | null }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: m.qr } })),
}));
vi.mock("../../adapters/fbReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbReceipt")>()), fbReceiptInfo: m.info }));
vi.mock("../../adapters/useReceiptPicture", () => ({ useReceiptPicture: (input: ReceiptInput | null) => { m.last = input; return { url: "blob:receipt", failed: false }; } }));

import { TProvider } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import ReceiptFormat from "../ReceiptFormat";
import type { BuyerReceipt } from "../../adapters/useReadData";

const receipt: BuyerReceipt = { num: 3, name: "Ann Reyes", handle: "@ann", lines: [{ item: "A1", total: 350 }], count: 1, total: 350, platform: "Facebook" };
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const open = async () => {
  const r = render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} /></TProvider>);
  await flush();
  return r;
};

beforeEach(() => { vi.clearAllMocks(); m.qr = null; m.last = null; m.info.mockResolvedValue({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 1 }); });

describe("Shipping fee box", () => {
  it("sits after '+ Add line', is empty on open with placeholder 'Optional', and goes into the picture", async () => {
    const r = await open();
    const box = q("rs-shipping") as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("Optional");
    expect(box.getAttribute("inputmode")).toBe("numeric");
    expect(q("rs-add-line")!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(m.last?.shippingFee).toBe(0);
    expect(m.last?.labels).toMatchObject({ shipping: "Shipping fee", howToPay: "How to pay", scanToPay: "Scan to pay" });
    fireEvent.change(box, { target: { value: "38" } });
    expect(m.last?.shippingFee).toBe(38);
    fireEvent.change(box, { target: { value: "abc" } }); // same number rules as the price fields
    expect(box.value).toBe("");
    expect(m.last?.shippingFee).toBe(0);
    r.unmount();
  });
  it("is empty again every time the sheet opens (never remembered)", async () => {
    const a = await open();
    fireEvent.change(q("rs-shipping")!, { target: { value: "60" } });
    a.unmount();
    await open();
    expect((q("rs-shipping") as HTMLInputElement).value).toBe("");
    expect(m.last?.shippingFee).toBe(0);
  });
  it("cents currencies get a decimal keypad", async () => {
    render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="₱" onClose={vi.fn()} /></TProvider>);
    await flush();
    expect(q("rs-shipping")!.getAttribute("inputmode")).toBe("decimal");
  });
});

describe("Payment QR row (read-only)", () => {
  it("a saved QR shows whole in a 160 × 160 white box (contain), under the note", async () => {
    m.qr = "data:image/png;base64,iVBORw0KGgo=";
    await open();
    const box = q("rs-qr-box")!;
    expect(box.style.width).toBe("160px");
    expect(box.style.height).toBe("160px");
    expect(box.style.background).toMatch(/#fff|rgb\(255, 255, 255\)/);
    const img = q("rs-qr-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(m.qr);
    expect(img.style.objectFit).toBe("contain");
    expect(q("rs-note")!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q("rs-qr-none")).toBeNull();
  });
  it("no QR saved → a muted line pointing to Receipt format", async () => {
    await open();
    expect(q("rs-qr-box")).toBeNull();
    expect(q("rs-qr-none")!.textContent).toBe("Add a payment QR picture in Receipt format.");
  });
});

describe("Receipt format sample picture", () => {
  it("uses the card labels (HOW TO PAY / Scan to pay) and no shipping fee", async () => {
    render(<TProvider lang="en"><ReceiptFormat onBack={vi.fn()} cur="NT$" /></TProvider>);
    await flush();
    expect(m.last?.labels).toMatchObject({ howToPay: "How to pay", scanToPay: "Scan to pay" });
    expect(m.last?.shippingFee ?? 0).toBe(0);
  });
});
