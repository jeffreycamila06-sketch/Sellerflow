// Seller Website v2 — item 11: the seller's payment methods list (name, instructions, optional QR, pay
// first / pay on delivery), ready lists per country, pay-first = today's flow, the money goes straight to
// the seller. A shop that never saved a list keeps today's bank / QR / pay-at-pickup.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { TProvider, buildT } from "../../redesign/i18n";
import WebsitePayShip from "../../redesign/screens/WebsitePayShip";
import type { PayShipApi } from "../../redesign/adapters/websiteEditorApi";
import type { MyWebsite, WebsiteSettings } from "../../redesign/adapters/websiteSeller";
import { readyPayMethods, editorPayMethods, withPayMethods, payProblems, newPayMethod } from "../../redesign/adapters/websiteShipPay";
import { payLabel, toCheckoutV2 } from "../shipPay";
import { paymentLabel, orderMessage } from "../orderText";
import { CheckoutFlow } from "../checkoutPages";
import type { OrderApi, OrderView } from "../orderApi";
import { validLines } from "../cart";
import type { ShopPage } from "../route";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;

describe("ready lists per country", () => {
  const ids = (c: string) => readyPayMethods(c).map((m) => `${m.id}:${m.kind}:${m.on ? "on" : "off"}`);
  it("Taiwan / Canada / Australia / Philippines / others — all start off", () => {
    expect(ids("TW")).toEqual(["bank:first:off", "qr:first:off", "cod:delivery:off"]);
    expect(ids("CA")).toEqual(["interac:first:off", "bank:first:off", "pod:delivery:off"]);
    expect(ids("AU")).toEqual(["payid:first:off", "bank:first:off", "pod:delivery:off"]);
    expect(ids("PH")).toEqual(["gcash:first:off", "maya:first:off", "bank:first:off", "codph:delivery:off"]);
    expect(ids("JP")).toEqual(["bank:first:off", "pod:delivery:off"]);
    expect(readyPayMethods("CA").find((m) => m.id === "bank")!.bank).toEqual({ bankName: "", accountName: "", accountNumber: "" });
  });
  it("labels", () => {
    expect(["bank", "qr", "cod", "pod", "codph", "interac", "payid", "gcash", "maya"].map((id) => payLabel(t, { id }))).toEqual(
      ["Bank transfer", "Payment QR", "Pay at pickup (貨到付款)", "Pay on delivery", "Cash on delivery (COD)", "Interac e-Transfer", "PayID", "GCash", "Maya"]);
  });
});

describe("the editor's list", () => {
  it("nothing saved, Taiwan → today's bank / QR / COD (with their on flags)", () => {
    const l = editorPayMethods({ bank: { enabled: true, bankName: "CTBC", accountNumber: "1" }, qr: { enabled: false, path: "u/site-qr-1.jpg", label: "LINE Pay" }, cod: { enabled: true } }, "TW");
    expect(l.map((m) => `${m.id}:${m.on}`)).toEqual(["bank:true", "qr:false", "cod:true"]);
    expect(l[0].bank).toEqual({ bankName: "CTBC", accountName: "", accountNumber: "1" });
    expect([l[1].qr, l[1].name]).toEqual(["u/site-qr-1.jpg", "LINE Pay"]);
  });
  it("nothing saved, Philippines → today's methods only if on, then the ready ones", () => {
    expect(editorPayMethods({ bank: { enabled: true } }, "PH").map((m) => m.id)).toEqual(["bank", "gcash", "maya", "codph"]);
  });
  it("saving writes the list + the old bank / QR / COD fields (for a rollback)", () => {
    const l = editorPayMethods({}, "TW").map((m) => (m.id === "bank" ? { ...m, on: true, bank: { bankName: "CTBC", accountName: "J", accountNumber: "9" } } : m.id === "cod" ? { ...m, on: true } : m));
    const s = withPayMethods({}, l);
    expect(s.payMethods!.map((m) => m.id)).toEqual(["bank", "qr", "cod"]);
    expect([s.bank, s.qr, s.cod]).toEqual([{ enabled: true, bankName: "CTBC", accountName: "J", accountNumber: "9" }, { enabled: false, path: undefined, label: undefined }, { enabled: true }]);
  });
  it("checks: a new method needs a name; a pay-first method needs something to pay with", () => {
    const n = newPayMethod(() => 0.5);
    expect(payProblems([n])).toEqual(["name", "empty"]);
    expect(payProblems([{ ...n, name: "Jko Pay", info: "0912" }])).toEqual([]);
    expect(payProblems([{ ...n, name: "Jko Pay", qr: "u/site-qr-2.jpg" }])).toEqual([]);
    expect(payProblems([{ ...n, name: "Cash", kind: "delivery" }])).toEqual([]);
  });
});

describe("checkout + order link", () => {
  const PH = { ...DEMO_SHOP, country: "PH", checkout2: toCheckoutV2({ options: [{ id: "jt", needs: "address", fee: 120, cod: true }, { id: "pickup", needs: "none", fee: 0, cod: true }],
    methods: [{ id: "gcash", kind: "first", info: "0917 123 4567 (Ana R.)", qr: "u/site-qr-2.jpg" }, { id: "codph", kind: "delivery" }], autoCancelHours: 24 })! };
  beforeEach(() => localStorage.clear());
  it("the buyer picks GCash → sent as pay 'gcash' + kind 'qr' (pay first, today's flow)", async () => {
    const placed: unknown[] = [];
    const api: OrderApi = { place: vi.fn(async (_s, i) => { placed.push(i); return { ok: true as const, orderNo: "W-0001", token: "f".repeat(64), total: 1 }; }), load: vi.fn(async () => null), uploadReceipt: vi.fn() };
    function H() { const [r, go] = useState<ShopPage>({ page: "checkout" }); return <TProvider lang="en"><CheckoutFlow shop={PH} cur="₱" route={r} go={go} infos={validLines(PH, [{ pid: 2, vid: null, qty: 1 }])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "x"} /></TProvider>; }
    render(<H />);
    expect(screen.getByTestId("co-pay-gcash")).toHaveTextContent("GCash");
    expect(screen.getByTestId("co-pay-codph")).toHaveTextContent("Cash on delivery (COD)");
    fireEvent.click(screen.getByTestId("co-del-pickup"));
    fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "09171234567" } });
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(placed).toHaveLength(1));
    expect(placed[0]).toMatchObject({ ship: "pickup", pay: "gcash", delivery: "pickup", payment: "qr" });
  });
  const VIEW: OrderView = { orderNo: "W-0003", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 1, name: "Tee", price: 300, qty: 1 }], subtotal: 300, shipFee: 0, total: 300,
    delivery: "pickup", payment: "qr", buyerName: "Ana", phoneTail: "567", receipt: false, createdAt: "2026-11-16T01:00:00Z", autoCancelAt: "2026-11-17T01:00:00Z",
    shop: { sub: "s" }, country: "PH", shipId: "pickup", payId: "gcash", pay: { method: { id: "gcash", kind: "first", info: "0917 123 4567 (Ana R.)", qr: "u/site-qr-2.jpg" } } };
  it("the order link shows the method's instructions + QR while payment is due", async () => {
    const api: OrderApi = { place: vi.fn(), load: vi.fn(async () => VIEW), uploadReceipt: vi.fn() };
    function H() { const [r, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) }); return <TProvider lang="en"><CheckoutFlow shop={DEMO_SHOP} cur="₱" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={api} linkFor={() => "x"} /></TProvider>; }
    render(<H />);
    expect(await screen.findByTestId("od-method")).toHaveTextContent("GCash");
    expect(screen.getByTestId("od-method-info")).toHaveTextContent("0917 123 4567 (Ana R.)");
    expect(screen.getByTestId("od-method-qr")).toBeInTheDocument();
    expect(screen.getByTestId("od-upload")).toBeInTheDocument(); // the receipt upload, as today
  });
  it("names in the order text + labels follow the picked method; older orders as before", () => {
    expect(paymentLabel(t, "qr", "gcash")).toBe("GCash");
    expect(paymentLabel(t, "bank", "c1abcd", "Jko Pay")).toBe("Jko Pay");
    expect(paymentLabel(t, "bank")).toBe("Bank transfer");
    expect(orderMessage(t, VIEW, "₱", "")).toContain("Payment: GCash");
  });
});

describe("the seller's Payment & shipping screen", () => {
  const SITE = (settings: WebsiteSettings = {}): MyWebsite => ({ subdomain: "budgetukay", draft: {}, published: null, publishedAt: null, settings, customDomain: null });
  it("Philippines: turn on GCash with instructions; a new pay-on-delivery method; saved as a list", async () => {
    const a: PayShipApi = { load: vi.fn(async () => SITE()), save: vi.fn(async () => true), uploadQr: vi.fn(async () => "u/site-qr-5.jpg") };
    render(<TProvider lang="en"><WebsitePayShip onToast={vi.fn()} api={a} country="PH" cur="₱" /></TProvider>);
    expect(await screen.findByTestId("wps-pay-gcash")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("wps-cod-note")).toBeNull(); // the 賣貨便 note is Taiwan-only
    fireEvent.click(screen.getByTestId("wps-pay-gcash"));
    fireEvent.click(screen.getByTestId("wps-save"));
    expect(await screen.findByTestId("wps-msg")).toHaveTextContent("Add instructions, a QR or bank details");
    fireEvent.change(screen.getByTestId("wps-pay-info-gcash"), { target: { value: "0917 123 4567 (Ana R.)" } });
    fireEvent.change(screen.getByTestId("wps-pay-qr-gcash").querySelector("input")!, { target: { files: [new File(["x"], "q.png", { type: "image/png" })] } });
    await waitFor(() => expect(a.uploadQr).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("wps-pay-add"));
    const kind = screen.getAllByTestId(/^wps-pay-kind-c/)[0];
    fireEvent.change(kind, { target: { value: "delivery" } });
    fireEvent.change(screen.getAllByTestId(/^wps-pay-name-c/)[0], { target: { value: "Cash at meet-up" } });
    fireEvent.click(screen.getByTestId("wps-save"));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    const saved = (a.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WebsiteSettings;
    const on = saved.payMethods!.filter((m) => m.on);
    expect(on.map((m) => `${m.id.startsWith("c") ? "new" : m.id}:${m.kind}:${m.info || m.name}`)).toEqual(["gcash:first:0917 123 4567 (Ana R.)", "new:delivery:Cash at meet-up"]);
    expect(on[0].qr).toBe("u/site-qr-5.jpg");
    expect(saved.cod).toEqual({ enabled: true });
  });
});

describe("sql/165 part 11 (contract)", () => {
  const sql = readFileSync("sql/165_seller_website_v2.sql", "utf8");
  it("pay first = today's flow; pay on delivery only where the option allows it; only uploaded QR pictures", () => {
    expect(sql).toMatch(/v_pay := case when v_meth->>'kind' = 'delivery' then 'cod' when v_meth \? 'qr' then 'qr' else 'bank' end;/);
    expect(sql).toMatch(/if v_meth is null or \(v_meth->>'kind' = 'delivery' and not coalesce\(\(v_opt->>'cod'\)::boolean, false\)\) then/);
    expect(sql).toMatch(/\/site-qr-\[0-9\]\{1,20\}\\\.jpg\$/);
    expect(readFileSync("sql/165_seller_website_v2_rollback.sql", "utf8")).toMatch(/drop column if exists pay_id, drop column if exists pay_name;/);
  });
});
