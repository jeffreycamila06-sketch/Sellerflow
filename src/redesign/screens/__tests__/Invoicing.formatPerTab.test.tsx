// Invoicing → Format follows the open tab. TikTok → "TikTok invoice format"; Instagram / Shopee → "Invoice
// format" (as before); Facebook with the Receipt add-on → "Facebook receipt format" (Opening, Payment note, Shipping
// fee, Payment QR picture, Sample); Facebook without it → "Invoice format" (as before). The note and the shipping fee
// are ONE saved value (seller_receipt_settings.note + invoice_shipping_fee): saved on one sheet, shown on the other
// and used by the TikTok message. No "Message type" row anywhere. In-memory database: adapters/__tests__/invoiceFakeDb.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const m = vi.hoisted(() => ({ render: vi.fn(), downscale: vi.fn() }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptSettings")>()), downscaleQrFile: m.downscale }));

import { TProvider, buildT } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";

const SID = "11111111-2222-3333-4444-555555555555";
const QR = "data:image/png;base64,iVBORw0KGgo=";
const QR2 = "data:image/png;base64,AAAA";
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const settle = async () => { for (let i = 0; i < 3; i++) await wait(400); };
const row = (n: number, handle: string, name: string, platform: string, product: string, price: number, min: number) =>
  ({ buyer_number: n, handle, customer_name: name, platform, product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
const ROWS = [row(1, "@ana", "ANA", "TikTok", "A1 dress", 350, 1), row(2, "Ana Cruz", "Ana Cruz", "Facebook", "Dress", 350, 3)];
const buyers = () => rebuildSessionFromRows(ROWS as never).buyers;
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(url).pathname;
  const json = path === "/fb/sendall/status" ? { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [{ n: 2, tag: "not_sent" }] } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});

type Kind = "addon_sendall" | "addon_soon" | "none";
function open(kind: Kind) {
  render(
    <TProvider lang="en"><div data-redesign="">
      <Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey={SID} sessionId={SID} sellerId="u1" todayId="2026-11-26" tapGuardMs={0}
        sessionStartedAt="2026-11-26T04:00:00.000Z" sessionWindowDays={1}
        {...(kind !== "none" ? { onReceiptFormat: () => {} } : {})} {...(kind === "addon_sendall" ? { fbSendAll: { lang: "en" } } : {})} />
    </div></TProvider>,
  );
}
const tab = async (p: string) => { fireEvent.click(q(`ivc-tab-${p}`)!); await flush(); };
const openFormat = async () => { fireEvent.click(q("ivc-format-btn")!); await flush(); };
const val = (id: string) => (q(id) as HTMLInputElement).value;
const upserts = () => DB.s.calls.filter((c) => c.op === "upsert" && c.table === "seller_receipt_settings").map((c) => c.payload!);
const pickFile = async () => {
  fireEvent.change(q("ivc-fbformat-qr-file")!, { target: { files: [new File([new Uint8Array([1, 2, 3])], "qr.png", { type: "image/png" })] } });
  await flush();
};

beforeEach(() => {
  DB.reset(); localStorage.clear();
  DB.s.settings.set("u1", { user_id: "u1", opening: "Hi {name}!", note: "Pay by GCash 0917", qr_image: QR, invoice_shipping_fee: 60 });
  copyText.mockReset(); copyText.mockImplementation(async () => true);
  m.render.mockReset(); m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  m.downscale.mockReset(); m.downscale.mockImplementation(async () => QR2);
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Format opens the sheet of the open tab", () => {
  for (const kind of ["addon_sendall", "addon_soon", "none"] as Kind[]) {
    it(`TikTok tab → "TikTok invoice format" (${kind})`, async () => {
      open(kind); await flush(); await openFormat();
      expect(q("ivc-format-title")!.textContent).toBe("TikTok invoice format");
      expect(q("ivc-fbformat-sheet")).toBeNull();
      expect(q("ivc-format-shared")?.textContent ?? null).toBe(kind === "none" ? null : "Also on your Facebook receipt.");
    });
    for (const p of ["instagram", "shopee"]) {
      it(`${p} tab → today's "Invoice format" (${kind})`, async () => {
        open(kind); await flush(); await tab(p); await openFormat();
        expect(q("ivc-format-title")!.textContent).toBe("Invoice format");
        expect(q("ivc-fbformat-sheet")).toBeNull();
      });
    }
  }
  for (const kind of ["addon_sendall", "addon_soon"] as Kind[]) {
    it(`Facebook tab with the Receipt add-on → "Facebook receipt format" with every field (${kind})`, async () => {
      open(kind); await flush(); await tab("facebook"); await openFormat();
      expect(q("ivc-format-sheet")).toBeNull();
      expect(q("ivc-fbformat-title")!.textContent).toBe("Facebook receipt format");
      expect(val("ivc-fbformat-opening")).toBe("Hi {name}!");
      expect(val("ivc-fbformat-note")).toBe("Pay by GCash 0917");
      expect(val("ivc-fbformat-fee")).toBe("60");
      expect((q("ivc-fbformat-qr-thumb") as HTMLImageElement).getAttribute("src")).toBe(QR);
      expect(q("ivc-fbformat-qr-pick")!.textContent).toBe("Change picture");
      expect(q("ivc-fbformat-qr-remove")!.textContent).toBe("Remove");
      expect(q("ivc-fbformat-shared")!.textContent).toBe("Also on your TikTok invoice.");
      expect(q("ivc-fbformat-sheet")!.textContent).not.toContain("Message type");
      await settle();
      expect(q("ivc-fbformat-sample")).not.toBeNull();
      // the sample = the Receipt format screen's sample, with the Invoicing shipping fee
      expect(m.render.mock.calls.at(-1)![0]).toMatchObject({ opening: "Hi {name}!", note: "Pay by GCash 0917", qrImage: QR, buyerNum: 12, buyerName: "Sample buyer", shippingFee: 60,
        lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }, { item: "C3 ×2", total: 500 }] });
    });
  }
  it("Facebook tab WITHOUT the add-on → today's \"Invoice format\" sheet", async () => {
    open("none"); await flush(); await tab("facebook"); await openFormat();
    expect(q("ivc-fbformat-sheet")).toBeNull();
    expect(q("ivc-format-title")!.textContent).toBe("Invoice format");
    expect(q("ivc-format-shared")).toBeNull();
  });
  it("the old \"Receipt format ›\" button still shows on the Facebook \"Soon\" card", async () => {
    open("addon_soon"); await flush(); await tab("facebook");
    expect(q("ivc-receipt-format")).not.toBeNull();
  });
});

describe("one note, one shipping fee", () => {
  it("saved on the Facebook sheet → one upsert of the same row; the TikTok sheet and the TikTok message show it", async () => {
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    fireEvent.change(q("ivc-fbformat-note")!, { target: { value: "BDO 1234" } });
    fireEvent.change(q("ivc-fbformat-fee")!, { target: { value: "45" } });
    fireEvent.change(q("ivc-fbformat-opening")!, { target: { value: "Hello!" } });
    fireEvent.click(q("ivc-fbformat-save")!); await flush();
    expect(upserts()).toHaveLength(1);
    const w = upserts()[0];
    expect(Object.keys(w).sort()).toEqual(["invoice_shipping_fee", "note", "opening", "qr_image", "updated_at", "user_id"]);
    expect(DB.s.settings.get("u1")).toMatchObject({ opening: "Hello!", note: "BDO 1234", invoice_shipping_fee: 45, qr_image: QR });
    fireEvent.click(q("ivc-fbformat-close")!); await flush();
    await tab("tiktok"); await openFormat();
    expect(val("ivc-format-note")).toBe("BDO 1234");
    expect(val("ivc-format-fee")).toBe("45");
    fireEvent.click(q("ivc-format-close")!); await flush();
    fireEvent.click(q("ivc-send-next")!); await flush();
    expect(copyText.mock.calls.at(-1)![0]).toContain("Shipping fee: ₱45");
    expect(copyText.mock.calls.at(-1)![0]).toContain("BDO 1234");
  });
  it("saved on the TikTok sheet → the Facebook sheet shows it (opening + QR untouched)", async () => {
    open("addon_sendall"); await flush(); await openFormat();
    fireEvent.change(q("ivc-format-note")!, { target: { value: "Line Pay only" } });
    fireEvent.change(q("ivc-format-fee")!, { target: { value: "" } });
    fireEvent.click(q("ivc-format-save")!); await flush();
    fireEvent.click(q("ivc-format-close")!); await flush();
    await tab("facebook"); await openFormat();
    expect(val("ivc-fbformat-note")).toBe("Line Pay only");
    expect(val("ivc-fbformat-fee")).toBe("");
    expect(val("ivc-fbformat-opening")).toBe("Hi {name}!");
    expect(DB.s.settings.get("u1")).toMatchObject({ opening: "Hi {name}!", qr_image: QR, note: "Line Pay only", invoice_shipping_fee: null });
  });
});

describe("the payment QR picture on the Facebook sheet", () => {
  it("Change picture → saved", async () => {
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    await pickFile();
    expect((q("ivc-fbformat-qr-thumb") as HTMLImageElement).getAttribute("src")).toBe(QR2);
    fireEvent.click(q("ivc-fbformat-save")!); await flush();
    expect(DB.s.settings.get("u1")!.qr_image).toBe(QR2);
  });
  it("Remove → saved as none; the button then says Choose picture", async () => {
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    fireEvent.click(q("ivc-fbformat-qr-remove")!); await flush();
    expect(q("ivc-fbformat-qr-thumb")).toBeNull();
    expect(q("ivc-fbformat-qr-pick")!.textContent).toBe("Choose picture");
    fireEvent.click(q("ivc-fbformat-save")!); await flush();
    expect(DB.s.settings.get("u1")!.qr_image).toBeNull();
    expect(DB.s.settings.get("u1")).toMatchObject({ opening: "Hi {name}!", note: "Pay by GCash 0917", invoice_shipping_fee: 60 });
  });
  it("a picture that can't be used says so and keeps the old one", async () => {
    m.downscale.mockImplementation(async () => null);
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    await pickFile();
    expect(q("ivc-fbformat-qr-failed")!.textContent).toBe("Couldn't use that picture. Try another one.");
    expect((q("ivc-fbformat-qr-thumb") as HTMLImageElement).getAttribute("src")).toBe(QR);
  });
});

describe("the Facebook sheet's own edge cases", () => {
  it("nothing changed → Save is off", async () => {
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    expect((q("ivc-fbformat-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(q("ivc-fbformat-opening")!, { target: { value: "x" } });
    expect((q("ivc-fbformat-save") as HTMLButtonElement).disabled).toBe(false);
  });
  it("the opening text + QR could not be read → a line + Try again, nothing can be saved", async () => {
    open("addon_sendall"); await flush(); await tab("facebook");
    DB.s.failFormatRead = true;
    await openFormat();
    expect(q("ivc-fbformat-error")!.textContent).toContain("Receipt settings aren't available yet.");
    expect(q("ivc-fbformat-opening")).toBeNull();
    expect((q("ivc-fbformat-save") as HTMLButtonElement).disabled).toBe(true);
    DB.s.failFormatRead = false;
    fireEvent.click(q("ivc-fbformat-retry")!); await flush();
    expect(val("ivc-fbformat-opening")).toBe("Hi {name}!");
  });
  it("a failed save says so and keeps what was typed", async () => {
    open("addon_sendall"); await flush(); await tab("facebook"); await openFormat();
    DB.s.failFormatWrite = true;
    fireEvent.change(q("ivc-fbformat-note")!, { target: { value: "BDO 1234" } });
    fireEvent.click(q("ivc-fbformat-save")!); await flush();
    expect(q("ivc-fbformat-save")!.textContent).toBe(buildT("en").rd_fb_save_failed);
    expect(val("ivc-fbformat-note")).toBe("BDO 1234");
    expect(DB.s.settings.get("u1")!.note).toBe("Pay by GCash 0917");
  });
});

describe("words", () => {
  const KEYS = ["rd_ivc_fmt_title_tt", "rd_ivc_fmt_shared_fb", "rd_ivc_fbf_title", "rd_ivc_fbf_shared_tt", "rd_ivc_fbf_fee_hint", "rd_ivc_fbf_qr_change"] as const;
  it("every new text is in all 8 app languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tt = buildT(lang as never) as unknown as Record<string, string>;
      for (const k of KEYS) expect(tt[k]?.trim(), `${lang} ${k}`).toBeTruthy();
    }
  });
  it("the removed Message type texts are gone", () => {
    const tt = buildT("en") as unknown as Record<string, string>;
    for (const k of ["rd_ivc_fmt_type", "rd_ivc_fmt_type_text", "rd_ivc_fmt_type_soon", "rd_ivc_fmt_shared"]) expect(tt[k]).toBeUndefined();
  });
});
