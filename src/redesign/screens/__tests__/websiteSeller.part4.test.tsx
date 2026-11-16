// Seller Website part 4 — the seller side: editor (draft vs published, address rules, plan rule:
// Free → "Upgrade to publish", iOS → locked Publish with no price / plan name and no own-domain row,
// Master → own domain "Connect"), Payment & shipping, Orders → Website tab (badge, receipt with the
// bank-app warning, Money received / Not received / Shipped / Cancel / Block), Sales line, Settings tile.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import WebsiteEditor from "../WebsiteEditor";
import WebsitePayShip from "../WebsitePayShip";
import WebsiteOrders from "../WebsiteOrders";
import SettingsHub from "../SettingsHub";
import SalesTab from "../SalesTab";
import { subdomainProblem, suggestSubdomain, planCanPublish, actionsFor, matchesFilter, wNo, type WebsiteOrder, type MyWebsite } from "../../adapters/websiteSeller";
import { checkoutFrom, shopProductsFrom, settingsProblems, previewShop, hasUnpublished, DEFAULT_SETTINGS } from "../../adapters/websiteEditor";
import type { EditorApi, PayShipApi, OrdersApi } from "../../adapters/websiteEditorApi";
import type { Product } from "../../adapters/products";
import type { UseSalesTab } from "../../adapters/salesTab";

const SITE: MyWebsite = { subdomain: "budgetukay", draft: { name: "BudgetUkay", tagline: "Ukay" }, published: { name: "BudgetUkay" }, publishedAt: "2026-11-14T02:00:00Z", settings: DEFAULT_SETTINGS, customDomain: null };
function editorApi(over: Partial<EditorApi> = {}): EditorApi {
  return { load: vi.fn(async () => SITE), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(async () => ({ ok: true as const, at: "2026-11-15T00:00:00Z" })),
    subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => "u/site-logo-1.jpg"), loadProducts: vi.fn(async () => []), ...over };
}
const ed = (p: Partial<Parameters<typeof WebsiteEditor>[0]> = {}) =>
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={editorApi()} {...p} /></TProvider>);

describe("pure rules", () => {
  it("address: 3–30, a–z 0–9 -, not reserved (same as the database)", () => {
    expect(subdomainProblem("budgetukay")).toBeNull();
    expect(subdomainProblem("ab")).toBe("short");
    expect(subdomainProblem("-ab")).toBe("chars");
    expect(subdomainProblem("Shop1")).toBe("chars");
    expect(subdomainProblem("admin")).toBe("reserved");
    expect(suggestSubdomain("Budget Ukay!")).toBe("budgetukay");
    expect(suggestSubdomain("名店")).toBe("");
    const sql = readFileSync("sql/163_seller_website.sql", "utf8");
    for (const w of ["admin", "www", "api", "sellerflowlive"]) expect(sql).toContain(`'${w}'`);
  });
  it("plan rule: Basic / Plus / Pro / Master, active, not expired; Free / pending / expired cannot publish", () => {
    const now = Date.parse("2026-11-15T00:00:00Z");
    for (const p of ["basic", "plus", "pro", "master", "Pro"]) expect(planCanPublish(p, "active", "2026-12-01", now)).toBe(true);
    expect(planCanPublish("free", "active", null, now)).toBe(false);
    expect(planCanPublish("pro", "pending", "2026-12-01", now)).toBe(false);
    expect(planCanPublish("pro", "active", "2026-11-01", now)).toBe(false);
    expect(planCanPublish("pro", "active", null, now)).toBe(true);
  });
  it("checkout options mirror the database (defaults 60 / 60, Home off, free-over 0 = off)", () => {
    expect(checkoutFrom({})).toEqual({ ship: { s711: { fee: 60 }, fm: { fee: 60 } }, cod: false, autoCancelHours: 24 });
    expect(checkoutFrom({ ship: { home: { enabled: true, fee: 150 } }, freeOver: 1500, bank: { enabled: true, bankName: "CTBC" }, autoCancelHours: 999 }))
      .toMatchObject({ ship: { home: { fee: 150 } }, freeOver: 1500, bank: { bankName: "CTBC" }, autoCancelHours: 168 });
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual(["pay"]);
    expect(settingsProblems({ ...DEFAULT_SETTINGS, ship: { s711: { enabled: false }, fm: { enabled: false } }, cod: { enabled: true } })).toEqual(["ship"]);
  });
  it("products → shop list: hidden out, variants under their product, photo 1 + extra photos", () => {
    const ps: Product[] = [
      { id: 1, name: "Dress", sku: "", price: 200, stock: 0, platform: "", status: "", liveCode: "B01", photoPaths: ["u/1-p2.jpg"], variant: { groups: [{ name: "Size", values: ["S"] }] } },
      { id: 2, name: "Dress", sku: "", price: 220, stock: 2, platform: "", status: "", liveCode: "B01-S", parentId: 1, variant: { values: ["S"], ownPrice: true } },
      { id: 3, name: "Hidden", sku: "", price: 9, stock: 1, platform: "", status: "", showOnWebsite: false },
    ];
    const out = shopProductsFrom(ps, new Map([[1, "u/1.jpg"]]));
    expect(out.map((p) => p.id)).toEqual([1]);
    expect(out[0].photos).toEqual(["u/1.jpg", "u/1-p2.jpg"]);
    expect(out[0].variants).toEqual([{ id: 2, values: ["S"], price: 220, stock: 2, photo: null, code: "B01-S" }]);
    expect(previewShop("x", { name: "N" }, {}, out, "TW", "master").powered).toBe(false);
    expect(hasUnpublished({ name: "A" }, { name: "B" })).toBe(true);
    expect(hasUnpublished({ name: "A" }, null)).toBe(false);
  });
  it("order actions by status + filters", () => {
    expect(actionsFor({ status: "payment_sent", payment: "bank" })).toEqual(["paid", "not_received", "cancel"]);
    expect(actionsFor({ status: "confirmed", payment: "cod" })).toEqual(["shipped", "cancel"]);
    expect(actionsFor({ status: "shipped", payment: "bank" })).toEqual([]);
    expect(wNo(7)).toBe("W-0007");
    const o = { status: "payment_sent", seenAt: null } as unknown as WebsiteOrder;
    expect(["new", "check", "unpaid", "all"].map((f) => matchesFilter(o, f as never))).toEqual([true, true, false, true]);
  });
});

describe("Website editor", () => {
  it("loads the website: address, live date, copy; edits stay a draft until Publish", async () => {
    ed();
    expect(await screen.findByTestId("wed-url")).toHaveTextContent("www.sellerflowlive.com/s/budgetukay"); // sql/164 off (default) → the path address
    expect(screen.getByTestId("wed-state")).toHaveTextContent("Published 2026-11-14");
    expect(screen.getByTestId("wed-state")).toHaveTextContent("You have changes that are not published yet.");
  });
  it("new website: name + address → Save inserts (exists = false)", async () => {
    const api = editorApi({ load: vi.fn(async () => null) });
    ed({ api });
    fireEvent.change(await screen.findByTestId("wed-name"), { target: { value: "Maria Shop" } });
    fireEvent.change(screen.getByTestId("wed-sub"), { target: { value: "Maria_Shop" } });
    expect((screen.getByTestId("wed-sub") as HTMLInputElement).value).toBe("mariashop");
    fireEvent.click(screen.getByTestId("wed-save"));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ subdomain: "mariashop", draft: { name: "Maria Shop" } }, false));
    expect(await screen.findByTestId("wed-msg")).toHaveTextContent("Saved");
  });
  it("taken address → says so, nothing published", async () => {
    const api = editorApi({ save: vi.fn(async () => ({ ok: false as const, reason: "taken" as const })) });
    ed({ api });
    fireEvent.click(await screen.findByTestId("wed-publish"));
    expect(await screen.findByTestId("wed-msg")).toHaveTextContent("This address is taken");
    expect(api.publish).not.toHaveBeenCalled();
  });
  it("paid plan: Publish saves then publishes", async () => {
    const api = editorApi();
    ed({ api });
    fireEvent.click(await screen.findByTestId("wed-publish"));
    await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("wed-publish")).toHaveTextContent("✓ Published"); // hotfix 3: button + toast (websitePublishFeedback.test)
  });
  it("Free: Publish locked + 'Upgrade to publish your website' (Android / web)", async () => {
    const onUpgrade = vi.fn();
    ed({ plan: "free", onUpgrade });
    expect(await screen.findByTestId("wed-publish-locked")).toBeDisabled();
    fireEvent.click(screen.getByTestId("wed-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
    expect(screen.getByTestId("wed-upgrade")).toHaveTextContent("Upgrade to publish your website");
  });
  it("iOS: locked Publish with NO price or plan name, and no own-domain row", async () => {
    const { container } = ed({ plan: "free", ios: true });
    expect(await screen.findByTestId("wed-publish-locked")).toBeDisabled();
    expect(screen.getByTestId("wed-locked-note")).toBeInTheDocument();
    expect(screen.queryByTestId("wed-upgrade")).toBeNull();
    expect(screen.queryByTestId("wed-domain")).toBeNull();
    expect(container.textContent).not.toMatch(/Upgrade|Master|Basic|Plus|Pro\b|plan|NT\$|\$\d/i);
  });
  it("own domain: Master can tap Connect (placeholder); others see it greyed", async () => {
    const onToast = vi.fn();
    const { unmount } = ed({ plan: "master", onToast });
    fireEvent.click(await screen.findByTestId("wed-domain-connect"));
    expect(onToast).toHaveBeenCalledWith("Connecting your own domain is coming soon.");
    unmount();
    ed({ plan: "pro" });
    expect(await screen.findByTestId("wed-domain-connect")).toBeDisabled();
  });
  it("preview shows the real shop pages with the draft (no network)", async () => {
    const api = editorApi({ loadProducts: vi.fn(async () => [{ id: 1, name: "Dress", price: 200, stock: 3, photos: [] }]) });
    ed({ api });
    fireEvent.click(await screen.findByTestId("wed-preview"));
    const sheet = await screen.findByTestId("wed-preview-sheet");
    expect(await within(sheet).findByTestId("shop-name")).toHaveTextContent("BudgetUkay");
    expect(within(sheet).getAllByTestId("shop-item")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("wed-preview-close"));
    expect(screen.queryByTestId("wed-preview-sheet")).toBeNull();
  });
});

describe("Payment & shipping", () => {
  const api = (over: Partial<PayShipApi> = {}): PayShipApi => ({ load: vi.fn(async () => SITE), save: vi.fn(async () => true), uploadQr: vi.fn(async () => "u/site-qr-1.jpg"), ...over });
  const ps = (a: PayShipApi) => render(<TProvider lang="en"><WebsitePayShip onToast={vi.fn()} api={a} /></TProvider>);
  it("needs one payment; COD note mentions 取貨付款 in 賣貨便 / 好賣+; save sends the settings", async () => {
    const a = api(); ps(a);
    fireEvent.click(await screen.findByTestId("wps-save"));
    expect(await screen.findByTestId("wps-msg")).toHaveTextContent("Turn on at least one payment.");
    expect(screen.getByTestId("wps-cod-note")).toHaveTextContent("取貨付款");
    expect(screen.getByTestId("wps-cod-note")).toHaveTextContent("賣貨便 / 好賣+");
    fireEvent.click(screen.getByTestId("wps-bank"));
    fireEvent.change(screen.getByTestId("wps-acct-no"), { target: { value: "0123" } });
    fireEvent.change(screen.getByTestId("wps-fee-s711"), { target: { value: "45" } });
    fireEvent.change(screen.getByTestId("wps-auto"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("wps-save"));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect((a.save as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ bank: { enabled: true, accountNumber: "0123" }, ship: { s711: { fee: 45 } }, autoCancelHours: 12 });
  });
});

const ORDER = (over: Partial<WebsiteOrder> = {}): WebsiteOrder => ({
  id: "o1", orderNo: 12, token: "f".repeat(64), status: "payment_sent", paymentIssue: false, buyerName: "Maria", buyerPhone: "0912345678", buyerContact: "maria.fb",
  delivery: "s711", storeId: "123456", storeName: "Xinyi", address: null, payment: "bank", items: [{ pid: 1, vid: 12, name: "Dress", label: "M", price: 350, qty: 2 }],
  subtotal: 700, shipFee: 60, total: 760, note: null, receiptPath: `${"f".repeat(64)}/r1.jpg`, receiptAt: "2026-11-15T01:00:00Z", autoCancelAt: null, paidAt: null, shippedAt: null,
  cancelledAt: null, cancelReason: null, seenAt: null, createdAt: "2026-11-15T01:00:00Z", ...over,
});
function ordersApi(list: WebsiteOrder[], over: Partial<OrdersApi> = {}): OrdersApi {
  return { load: vi.fn(async () => list), blocked: vi.fn(async () => new Set<string>()), receipt: vi.fn(async () => "https://signed/receipt.jpg"), shopSub: vi.fn(async () => "budgetukay"),
    act: vi.fn(async (_id: string, a: string) => ({ ok: true as const, status: (a === "paid" ? "paid" : a === "shipped" ? "shipped" : a === "cancel" ? "cancelled" : a === "not_received" ? "awaiting_payment" : "payment_sent") as WebsiteOrder["status"], blocked: a === "block" })), ...over };
}
describe("Orders → Website tab", () => {
  it("new orders first, badge count reported; opening an order clears its New badge", async () => {
    const api = ordersApi([ORDER(), ORDER({ id: "o2", orderNo: 11, status: "shipped", seenAt: "2026-11-14T00:00:00Z" })]);
    const onNew = vi.fn();
    render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} onNewCount={onNew} api={api} /></TProvider>);
    await waitFor(() => expect(onNew).toHaveBeenCalledWith(1));
    expect(screen.getByTestId("wor-f-new")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("wor-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("wor-row"));
    expect(api.act).toHaveBeenCalledWith("o1", "seen");
    expect(onNew).toHaveBeenLastCalledWith(0);
  });
  it("receipt: the bank-app warning, then the picture (signed link)", async () => {
    const api = ordersApi([ORDER()]);
    render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={api} /></TProvider>);
    fireEvent.click(await screen.findByTestId("wor-row"));
    expect(screen.getByTestId("wor-receipt-warn")).toHaveTextContent("Check your bank app first");
    fireEvent.click(screen.getByTestId("wor-receipt-open"));
    expect(await screen.findByTestId("wor-receipt-img")).toHaveAttribute("src", "https://signed/receipt.jpg");
    expect(api.receipt).toHaveBeenCalledWith(`${"f".repeat(64)}/r1.jpg`);
  });
  it("Money received → Mark as shipped; Cancel needs a confirm; Block buyer", async () => {
    const api = ordersApi([ORDER()]); const toast = vi.fn();
    render(<TProvider lang="en"><WebsiteOrders onToast={toast} api={api} /></TProvider>);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-act-paid"));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith("o1", "paid"));
    expect(await screen.findByTestId("wor-act-shipped")).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Updated — the buyer's order link shows it");
    fireEvent.click(screen.getByTestId("wor-act-cancel"));
    expect(api.act).not.toHaveBeenCalledWith("o1", "cancel");
    fireEvent.click(screen.getByTestId("wor-cancel-yes"));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith("o1", "cancel"));
    fireEvent.click(screen.getByTestId("wor-block"));
    expect(await screen.findByTestId("wor-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("wor-link")).toHaveTextContent("Buyer's order link");
  });
  it("load failure → honest message", async () => {
    render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={ordersApi([], { load: vi.fn(async () => null) })} /></TProvider>);
    expect(await screen.findByTestId("wor-failed")).toBeInTheDocument();
  });
});

describe("Settings tile + Sales line + gating", () => {
  const hub = (p: Record<string, unknown> = {}) => render(<TProvider lang="en"><SettingsHub onGeneral={vi.fn()} onCustomers={vi.fn()} onAdmin={vi.fn()} onCustomerData={vi.fn()} onLegal={vi.fn()} onDelete={vi.fn()} onLogout={vi.fn()} {...p} /></TProvider>);
  it("the Website tile only with the gate", () => {
    const { unmount } = hub();
    expect(screen.queryByTestId("tile-website")).toBeNull();
    unmount();
    const go = vi.fn(); hub({ onWebsite: go });
    fireEvent.click(screen.getByTestId("tile-website"));
    expect(go).toHaveBeenCalled();
  });
  it("Sales: the website line for the same days; absent → no line", async () => {
    const sales = { data: { revenue: 100, orders: 1, buyers: 1, aov: 100, trendUnit: "day", dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null, days: [{ d: "2026-11-15", rev: 100, orders: 1 }], bestDay: null, topProducts: [], topBuyers: [], start: "2026-11-15", end: "2026-11-15" }, state: "live", range: "today", load: vi.fn(), reload: vi.fn() } as unknown as UseSalesTab;
    const { unmount } = render(<TProvider lang="en"><SalesTab sales={sales} /></TProvider>);
    expect(screen.queryByTestId("sales-website")).toBeNull();
    expect(screen.getByTestId("sales-summary").textContent).toContain("NT$100"); // without the website: live only, as before
    unmount();
    const web = vi.fn(async () => ({ orders: 3, revenue: 2280, buyers: 2, days: [] }));
    render(<TProvider lang="en"><SalesTab sales={sales} website={web} /></TProvider>);
    expect(await screen.findByTestId("sales-website")).toHaveTextContent("3 orders · NT$2,280");
    expect(screen.getByTestId("sales-website")).toHaveTextContent("Included in the totals above.");
    expect(web).toHaveBeenCalledWith("2026-11-15", "2026-11-15");
    // Jeff 2026-11-15: the overall tiles include the website (live 100 / 1 order / 1 buyer + website 2,280 / 3 / 2)
    const tiles = screen.getByTestId("sales-summary").textContent || "";
    expect(tiles).toContain("NT$2,380"); expect(tiles).toContain("4"); expect(tiles).toContain("3"); expect(tiles).toContain("NT$595");
    expect((sales.data as { revenue: number }).revenue).toBe(100); // the live numbers themselves are untouched
  });
  it("RedesignApp: every website screen / tab / badge / read sits behind sellerWebsiteOn", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('{screen === "website" && sellerWebsiteOn && (');
    expect(src).toContain('{screen === "websitepay" && sellerWebsiteOn && (');
    expect(src).toContain('ordersTab === "website" && sellerWebsiteOn');
    expect(src).toContain("onWebsite={sellerWebsiteOn ? () => setScreen(\"website\") : undefined}");
    expect(src).toContain("website={sellerWebsiteOn ? loadWebsiteSales : undefined}");
    expect(src).toContain("if (!authed || !sellerWebsiteOn) return;");
    expect(src).toContain("onUpgrade={ios ? undefined : () => setScreen(\"subscription\")}");
  });
});
