// Invoicing → Facebook list: each row's total = the Total on the picture the buyer gets (Jeff 2026-11-28: #1 was
// edited to 99 + 100 + shipping 60 = NT$259 on the picture, but the row still said NT$99 and #2 NT$0). Same rule as
// the picture (receiptLayout receiptTotalText): priced lines + shipping; a line without a price = "to be confirmed".
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const m = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider, buildT } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { _resetReceiptEditSaves } from "../../adapters/fbReceiptEdit";
import { receiptTotalText } from "../../../lib/receiptLayout.js";

const SID = "11111111-2222-3333-4444-555555555555";
const t = buildT("en") as unknown as Record<string, string>;
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const fb = (n: number, name: string, product: string, price: number, min = n) =>
  ({ buyer_number: n, handle: name, customer_name: name, platform: "Facebook", product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
// #1 = Jeff's buyer: two lines, "99" for ₱99 and "200" for ₱0
const ROWS = [fb(1, "Jeff Buyer", "99", 99, 1), fb(1, "Jeff Buyer", "200", 0, 2), fb(2, "Ana Cruz", "Dress", 350, 3), fb(6, "Mia Go", "Cap", 90, 6)];
const buyers = () => rebuildSessionFromRows(ROWS as never).buyers;
const STATUS = { ok: true, access: true, allowed: true, job: null, needsMessaging: false,
  buyers: [{ n: 1, tag: "not_sent" }, { n: 2, tag: "not_sent" }, { n: 6, tag: "unknown" }] };
const S = { calls: [] as { path: string; body: Record<string, unknown> }[] };
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  S.calls.push({ path, body: JSON.parse(init.body) });
  const json = path === "/fb/sendall/status" ? STATUS : path === "/fb/sendall/start" ? { ok: true, already: false } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});
async function open() {
  render(
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey={SID} sessionId={SID} sellerId="u1" todayId="2026-11-26" tapGuardMs={0}
          onReceiptFormat={() => {}} fbSendAll={{ lang: "en" }} />
      </div>
    </TProvider>,
  );
  await flush();
  fireEvent.click(q("ivc-tab-facebook")!);
  await flush();
}
const rowOf = (n: number) => [...document.querySelectorAll("[data-testid='ivc-fb-row']")].find((r) => r.getAttribute("data-buyer") === String(n))! as HTMLElement;
const view = async (n: number) => { fireEvent.click(rowOf(n).querySelector("[data-testid='ivc-fb-row-view']")!); await flush(); };
const inSheet = (id: string) => [...q("ivc-fb-sheet")!.querySelectorAll(`[data-testid='${id}']`)] as HTMLInputElement[];
const btn = (id: string) => q(id) as HTMLButtonElement;

beforeEach(() => {
  _resetReceiptEditSaves();
  DB.reset(); localStorage.clear();
  DB.s.settings.set("u1", { user_id: "u1", opening: "Hi!", note: "Pay by GCash", qr_image: null, invoice_shipping_fee: 60 });
  S.calls = [];
  m.render.mockReset();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); _resetReceiptEditSaves(); });


const rowTotal = (n: number) => rowOf(n).querySelector("[data-testid='ivc-fb-row-total']")!.textContent;
// the Total text of the picture the editor drew last (the same input Send all draws)
const pictureTotal = () => { const inp = m.render.mock.calls.at(-1)![0]; return receiptTotalText(inp.lines, inp.currency, t.rd_rc_pic_tbc, inp.shippingFee ?? 0).text; };

describe("the row total = the picture's Total", () => {
  it("#1 (\"99\" ₱99 + \"200\" ₱0, shipping 60): 'to be confirmed' like its picture; edited to ₱100 → ₱259 on the row, the picture and the sum", async () => {
    await open();
    expect(rowTotal(1)).toBe(t.rd_rc_pic_tbc);
    expect(rowTotal(2)).toBe("₱410");                          // Dress 350 + shipping 60
    await view(1); await wait(1200);
    expect(pictureTotal()).toBe(t.rd_rc_pic_tbc);
    fireEvent.change(inSheet("rs-price")[1], { target: { value: "100" } });
    fireEvent.click(btn("ivc-fb-save")); await flush(); await wait(1200);
    expect(pictureTotal()).toBe("₱259");
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    expect(rowTotal(1)).toBe("₱259");
    expect(q("ivc-fb-summary-line")!.textContent).toBe(`3 Facebook buyers · ₱${(259 + 410 + 150).toLocaleString("en-US")}`);
  });
  it("an edit without shipping and a cancelled buyer: the row follows the edit; a cancelled buyer is out of the sum", async () => {
    await open(); await view(2);
    fireEvent.change(inSheet("rs-shipping")[0], { target: { value: "" } });
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "300" } });
    fireEvent.click(btn("ivc-fb-save")); await flush();
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    expect(rowTotal(2)).toBe("₱300");
    await view(6);
    fireEvent.click(q("ivc-fb-sheet-cancel")!); await flush(); await flush();
    expect(q("ivc-fb-summary-line")!.textContent).toBe("2 Facebook buyers · ₱300");   // #1 to be confirmed, #6 cancelled
  });
});

describe("review R1: the Invoicing shipping fee could not be read", () => {
  it("the Facebook list shows the load error + Try again (never totals without shipping); Try again → totals with shipping", async () => {
    DB.s.failFormatRead = true;
    await open();
    expect(q("ivc-fb-error")).not.toBeNull();
    expect(q("ivc-fb-list")).toBeNull();
    expect(document.querySelector("[data-testid='ivc-fb-row-total']")).toBeNull();
    DB.s.failFormatRead = false;
    fireEvent.click(q("ivc-fb-retry")!); await flush(); await flush();
    expect(q("ivc-fb-error")).toBeNull();
    expect(rowTotal(2)).toBe("₱410");
  });
});
