// Seller Website hotfix 4 — the editor showed budgetukay.sellerflowlive.com before it opened (no
// DNS yet). app_settings website_subdomain_ready (sql/164, seeded 'false'): while it is not the
// exact string 'true', the editor's main link, Copy and every shared link (the buyer's order link
// in Orders → Website) use https://www.sellerflowlive.com/s/<sub>; when 'true', <sub>.sellerflowlive.com.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import WebsiteEditor from "../WebsiteEditor";
import WebsiteOrders from "../WebsiteOrders";
import type { EditorApi, OrdersApi } from "../../adapters/websiteEditorApi";
import type { WebsiteOrder } from "../../adapters/websiteSeller";
import { DEFAULT_SETTINGS } from "../../adapters/websiteEditor";
import { parseSwitches, SWITCHES_OFF, FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import { shareUrl } from "../../../website/route";

const T = "f".repeat(64);
const SITE = { subdomain: "budgetukay", draft: { name: "BudgetUkay" }, published: { name: "BudgetUkay" }, publishedAt: "2026-11-14T02:00:00Z", settings: DEFAULT_SETTINGS, customDomain: null };
const editorApi = (): EditorApi => ({ load: vi.fn(async () => SITE), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(async () => ({ ok: true as const, at: "x" })), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => []) });
const ORDER: WebsiteOrder = { id: "o1", orderNo: 12, token: T, status: "payment_sent", paymentIssue: false, buyerName: "Maria", buyerPhone: "0912345678", buyerContact: null, delivery: "s711", storeId: "123456", storeName: "Xinyi", address: null, payment: "bank",
  items: [{ pid: 1, name: "Dress", price: 350, qty: 1 }], subtotal: 350, shipFee: 60, total: 410, note: null, receiptPath: null, receiptAt: null, autoCancelAt: null, paidAt: null, shippedAt: null, cancelledAt: null, cancelReason: null, seenAt: "2026-11-15T00:00:00Z", createdAt: "2026-11-15T00:00:00Z" };
const ordersApi = (): OrdersApi => ({ load: vi.fn(async () => [ORDER]), blocked: vi.fn(async () => new Set<string>()), receipt: vi.fn(async () => null), shopSub: vi.fn(async () => "budgetukay"), act: vi.fn(async () => ({ ok: true as const, status: "payment_sent" as const, blocked: false })) });

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => { writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } }); });

describe("shareUrl", () => {
  it("path address unless the switch is exactly true", () => {
    expect(shareUrl("budgetukay", false)).toBe("https://www.sellerflowlive.com/s/budgetukay");
    expect(shareUrl("budgetukay", true)).toBe("https://budgetukay.sellerflowlive.com");
  });
  it("the switch: key website_subdomain_ready, off unless the value is exactly 'true'", () => {
    expect(FEATURE_SWITCH_KEYS.websiteSubdomainReady).toBe("website_subdomain_ready");
    expect(SWITCHES_OFF.websiteSubdomainReady).toBe(false);
    expect(parseSwitches([{ key: "website_subdomain_ready", value: "false" }]).websiteSubdomainReady).toBe(false);
    expect(parseSwitches([{ key: "website_subdomain_ready", value: "TRUE" }]).websiteSubdomainReady).toBe(false);
    expect(parseSwitches([]).websiteSubdomainReady).toBe(false);
    expect(parseSwitches([{ key: "website_subdomain_ready", value: "true" }]).websiteSubdomainReady).toBe(true);
  });
});

describe("Editor link + Copy", () => {
  const ed = (subdomainReady?: boolean) => render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={editorApi()} subdomainReady={subdomainReady} /></TProvider>);
  it("not ready (default): shows + copies www.sellerflowlive.com/s/<sub>, never the subdomain", async () => {
    const { container } = ed();
    expect(await screen.findByTestId("wed-url")).toHaveTextContent(/^www\.sellerflowlive\.com\/s\/budgetukay$/);
    fireEvent.click(screen.getByTestId("wed-copy"));
    expect(writeText).toHaveBeenCalledWith("https://www.sellerflowlive.com/s/budgetukay");
    expect(container.textContent).not.toContain("budgetukay.sellerflowlive.com");
  });
  it("ready: shows + copies https://<sub>.sellerflowlive.com, the path as the small second line", async () => {
    const { container } = ed(true);
    expect(await screen.findByTestId("wed-url")).toHaveTextContent(/^budgetukay\.sellerflowlive\.com$/);
    fireEvent.click(screen.getByTestId("wed-copy"));
    expect(writeText).toHaveBeenCalledWith("https://budgetukay.sellerflowlive.com");
    expect(container.textContent).toContain("www.sellerflowlive.com/s/budgetukay");
  });
});

describe("Orders → Website: the buyer's order link", () => {
  const open = async (subdomainReady?: boolean) => {
    render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={ordersApi()} subdomainReady={subdomainReady} /></TProvider>);
    fireEvent.click(await screen.findByTestId("wor-f-all"));
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(await screen.findByTestId("wor-link"));
  };
  it("not ready: www.sellerflowlive.com/s/<sub>/o/<token>", async () => {
    await open();
    expect(writeText).toHaveBeenCalledWith(`https://www.sellerflowlive.com/s/budgetukay/o/${T}`);
  });
  it("ready: <sub>.sellerflowlive.com/o/<token>", async () => {
    await open(true);
    expect(writeText).toHaveBeenCalledWith(`https://budgetukay.sellerflowlive.com/o/${T}`);
  });
});

describe("wiring + SQL", () => {
  it("RedesignApp passes the switch to the editor and the orders tab", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toMatch(/<WebsiteOrders [^>]*subdomainReady=\{featureSw\.websiteSubdomainReady\}/);
    expect(src).toMatch(/<WebsiteEditor [\s\S]{0,600}subdomainReady=\{featureSw\.websiteSubdomainReady\}/);
  });
  it("no seller-app screen builds the subdomain address on its own", () => {
    for (const f of ["src/redesign/screens/WebsiteEditor.tsx", "src/redesign/screens/WebsiteOrders.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/shopUrl\([^)]*,\s*true\)/);
      expect(src).not.toMatch(/`https:\/\/\$\{[^}]+\}\.sellerflowlive\.com/);
    }
  });
  it("sql/164 seeds 'false' (add-only) and the rollback deletes only that row", () => {
    const up = readFileSync("sql/164_website_subdomain_ready.sql", "utf8");
    expect(up).toMatch(/insert into public\.app_settings \(key, value\) values \('website_subdomain_ready', 'false'\)\s*on conflict \(key\) do nothing;/);
    expect(up.replace(/^--.*$/gm, "")).not.toMatch(/\b(update|delete|drop|alter)\b/i);
    const down = readFileSync("sql/164_website_subdomain_ready_rollback.sql", "utf8");
    expect(down.replace(/^--.*$/gm, "").trim()).toBe("delete from public.app_settings where key = 'website_subdomain_ready';");
  });
});
