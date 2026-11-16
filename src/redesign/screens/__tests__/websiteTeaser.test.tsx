// Seller Website teaser (sql/169): sellers WITHOUT the website see the Settings card and the Sales
// "Website orders" row with "Soon"; a tap opens the support Telegram chat. Two switches, both 'false'
// by default (off = exactly as before). Testers / admins see no change.
import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import SettingsHub from "../SettingsHub";
import SalesTab from "../SalesTab";
import { websiteTeaserVisible, sellerWebsiteVisible } from "../../adapters/sellerWebsiteGate";
import { parseSwitches, SWITCHES_OFF, FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import { TELEGRAM_URL } from "../../../lib/telegram";
import type { SalesHistData } from "../../adapters/salesReport";
import type { UseSalesTab } from "../../adapters/salesTab";

const noop = () => {};
const PLAN_WORDS = /upgrade|subscri|plan\b|basic|plus\b|pro\b|master|NT\$|\$\d|price/i;
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const SOON: Record<string, string> = { en: "Soon", fil: "Malapit na", zh: "即将推出", "zh-TW": "即將推出", vi: "Sắp có", th: "เร็ว ๆ นี้", id: "Segera", bg: "Скоро" };

describe("the switches and the gate", () => {
  it("two switches, both off unless the exact string 'true'", () => {
    expect(FEATURE_SWITCH_KEYS.websiteTeaser).toBe("website_teaser_enabled");
    expect(FEATURE_SWITCH_KEYS.websiteTeaserSales).toBe("website_teaser_sales_enabled");
    expect(SWITCHES_OFF.websiteTeaser).toBe(false);
    expect(SWITCHES_OFF.websiteTeaserSales).toBe(false);
    expect(parseSwitches([{ key: "website_teaser_enabled", value: "true" }, { key: "website_teaser_sales_enabled", value: "TRUE" }])).toMatchObject({ websiteTeaser: true, websiteTeaserSales: false });
    expect(parseSwitches([])).toMatchObject({ websiteTeaser: false, websiteTeaserSales: false });
  });
  it("shown only with the switch on, to a seller without the website, never to an admin", () => {
    expect(websiteTeaserVisible({ switchOn: true, hasWebsite: false, isAdmin: false })).toBe(true);
    expect(websiteTeaserVisible({ switchOn: false, hasWebsite: false, isAdmin: false })).toBe(false);
    expect(websiteTeaserVisible({ switchOn: true, hasWebsite: true, isAdmin: false })).toBe(false); // tester / switch on
    expect(websiteTeaserVisible({ switchOn: true, hasWebsite: false, isAdmin: true })).toBe(false); // admin
    // the real website gate is unchanged: the teaser never gives access
    expect(sellerWebsiteVisible(false, false)).toBe(false);
  });
  it("sql/169 seeds both switches 'false' (add-only) and its rollback removes only them", () => {
    const up = readFileSync("sql/169_website_teaser.sql", "utf8").replace(/^--.*$/gm, "");
    expect(up).toMatch(/insert into public\.app_settings \(key, value\) values \('website_teaser_enabled', 'false'\)\s*on conflict \(key\) do nothing;/);
    expect(up).toMatch(/insert into public\.app_settings \(key, value\) values \('website_teaser_sales_enabled', 'false'\)\s*on conflict \(key\) do nothing;/);
    expect(up).not.toMatch(/\b(update|delete|drop|alter|create)\b/i);
    const down = readFileSync("sql/169_website_teaser_rollback.sql", "utf8").replace(/^--.*$/gm, "").trim();
    expect(down).toBe("delete from public.app_settings where key in ('website_teaser_enabled', 'website_teaser_sales_enabled');");
  });
});

const hub = (extra: Record<string, unknown>, lang = "en") => render(<TProvider lang={lang}><SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} {...extra} /></TProvider>);

describe("Settings: the Website card with Soon", () => {
  it("non-tester + switch on: the same card, 'Soon', a real link to the support Telegram chat, nothing else", () => {
    const { getByTestId, queryByTestId } = hub({ websiteTeaser: true });
    const a = getByTestId("tile-website-soon");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.textContent).toBe("WebsiteYour own shop pageSoon");
    expect(within(a).getByTestId("soon-badge").getAttribute("title")).toBeNull(); // no explanation
    expect(a.textContent).not.toMatch(PLAN_WORDS);
    expect(queryByTestId("tile-website")).toBeNull(); // the real card (editor) is not there
  });
  it("'Soon' in all 8 languages", () => {
    for (const l of LANGS) {
      const { getByTestId, unmount } = hub({ websiteTeaser: true }, l);
      expect(getByTestId("soon-badge").textContent, l).toBe(SOON[l]);
      unmount();
    }
  });
  it("switch off: exactly as before (same HTML as without the prop)", () => {
    const a = hub({}); const before = a.container.innerHTML; a.unmount();
    const b = hub({ websiteTeaser: false });
    expect(b.container.innerHTML).toBe(before);
    expect(b.queryByTestId("tile-website-soon")).toBeNull();
  });
  it("tester (has the website): the real card, unchanged, even with the teaser on", () => {
    const onWebsite = vi.fn();
    const a = hub({ onWebsite }); const before = a.container.innerHTML; a.unmount();
    const b = hub({ onWebsite, websiteTeaser: true });
    expect(b.container.innerHTML).toBe(before);
    expect(b.queryByTestId("tile-website-soon")).toBeNull();
  });
  it("iPhone app: no plan / price / upgrade words (the card is the same on every platform)", () => {
    const { getByTestId } = hub({ websiteTeaser: true });
    expect(getByTestId("tile-website-soon").textContent).not.toMatch(PLAN_WORDS);
  });
});

const DATA: SalesHistData = {
  revenue: 61240, orders: 188, buyers: 121, aov: 326, trendUnit: "day",
  dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
  days: [{ d: "2026-09-01", rev: 6100, orders: 20 }, { d: "2026-09-02", rev: 11200, orders: 40 }],
  bestDay: { d: "2026-09-02", rev: 11200, orders: 40 }, topProducts: [],
  topBuyers: [{ name: "Maria Santos", handle: "maria_shops", spent: 5820, orders: 14 }],
  start: "2026-09-01", end: "2026-09-28",
};
const hook = (): UseSalesTab => ({ data: DATA, state: "live", range: "session", load: vi.fn(), reload: vi.fn() });
const sales = (extra: Record<string, unknown>, lang = "en") => render(<TProvider lang={lang}><SalesTab cur="NT$" sessionStart="2026-09-01" today="2026-09-28" sales={hook()} {...extra} /></TProvider>);

describe("Sales: the Website orders row with Soon", () => {
  it("non-tester + switch on: the row with 'Soon' in place of the numbers, no 'Included in the totals above', a link to Telegram", () => {
    const { getByTestId, queryByTestId, container } = sales({ websiteTeaser: true });
    const a = getByTestId("sales-website-soon");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(a.textContent).toBe("🛍 Website ordersSoon");
    expect(container.textContent).not.toContain("Included in the totals above");
    expect(queryByTestId("sales-website")).toBeNull();
  });
  it("totals and everything else unchanged (the page minus the row = the page without the teaser)", () => {
    const a = sales({}); const before = a.container.innerHTML; a.unmount();
    const b = sales({ websiteTeaser: true });
    const html = b.container.cloneNode(true) as HTMLElement;
    html.querySelector("[data-testid=sales-website-soon]")!.remove();
    expect(html.innerHTML).toBe(before);
    expect(b.getByTestId("sales-summary").textContent).toContain("NT$61,240");
  });
  it("switch off: exactly as before", () => {
    const a = sales({}); const before = a.container.innerHTML; a.unmount();
    expect(sales({ websiteTeaser: false }).container.innerHTML).toBe(before);
  });
  it("tester (has the website): the real row, the teaser never shows", async () => {
    const website = vi.fn(async () => ({ orders: 3, revenue: 900, buyers: 2, days: [] }));
    const { findByTestId, queryByTestId } = sales({ website, websiteTeaser: true });
    expect(await findByTestId("sales-website")).toHaveTextContent("Included in the totals above");
    expect(queryByTestId("sales-website-soon")).toBeNull();
  });
});

describe("the real website stays gated (a non-tester can't open it)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("the teaser follows its own switch and never the website's access", () => {
    expect(src).toContain('const websiteTeaserOn = websiteTeaserVisible({ switchOn: featureSw.websiteTeaser, hasWebsite: sellerWebsiteOn, isAdmin });');
    expect(src).toContain('const websiteTeaserSalesOn = websiteTeaserVisible({ switchOn: featureSw.websiteTeaserSales, hasWebsite: sellerWebsiteOn, isAdmin });');
    expect(src).toContain('const sellerWebsiteOn = sellerWebsiteVisible(featureSw.sellerWebsite, hasFeature("seller_website"));');
  });
  it("every website screen renders only with website access; the only way in is the real card", () => {
    expect(src).toContain('{screen === "website" && sellerWebsiteOn && (');
    expect(src).toContain('{screen === "websitepay" && sellerWebsiteOn && (');
    expect(src).toContain('{screen === "orders" && ordersTab === "website" && sellerWebsiteOn && (');
    expect(src.match(/setScreen\("website"\)/g)).toHaveLength(1);
    expect(src).toContain('onWebsite={sellerWebsiteOn ? () => setScreen("website") : undefined}');
  });
  it("the seller app opens no screen from its address (only the Facebook / Shopee / Instagram login returns read it)", () => {
    const reads = src.match(/location\.(pathname|hash|search)/g) || [];
    expect(reads).toEqual(["location.search", "location.search", "location.search"]);
    expect(src).not.toMatch(/location\.(pathname|hash)/);
  });
});
