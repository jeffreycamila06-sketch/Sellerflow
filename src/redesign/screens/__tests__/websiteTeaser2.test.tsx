// Seller Website teaser, part 2: the Sales row is not tappable; the Orders "Website" tab with "Soon"
// (sql/170, not tappable); the Settings card opens the support Telegram chat with a ready message.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { TProvider } from "../../i18n";
import SettingsHub from "../SettingsHub";
import SalesTab from "../SalesTab";
import OrdersMinersTabs from "../../components/OrdersMinersTabs";
import { telegramDraftUrl, TELEGRAM_URL } from "../../../lib/telegram";
import { parseSwitches, SWITCHES_OFF, FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import { websiteTeaserVisible } from "../../adapters/sellerWebsiteGate";
import type { SalesHistData } from "../../adapters/salesReport";
import type { UseSalesTab } from "../../adapters/salesTab";

const noop = () => {};
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
afterEach(() => vi.restoreAllMocks());

describe("Settings card: the support chat with a ready message", () => {
  const hub = (lang: string) => render(<TProvider lang={lang}><SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} websiteTeaser /></TProvider>);
  it("English and Filipino: the exact links", () => {
    const en = hub("en");
    expect(en.getByTestId("tile-website-soon").getAttribute("href")).toBe("https://t.me/SellerFlowLive?text=Hi!%20I'm%20interested%20in%20the%20SellerFlowLive%20Website.");
    en.unmount();
    const fil = hub("fil");
    expect(fil.getByTestId("tile-website-soon").getAttribute("href")).toBe("https://t.me/SellerFlowLive?text=Hi!%20Interesado%20ako%20sa%20SellerFlowLive%20Website.");
  });
  it("every language: the same chat, the message in that language, 'Website' untranslated", () => {
    for (const l of LANGS) {
      const r = hub(l);
      const href = r.getByTestId("tile-website-soon").getAttribute("href")!;
      expect(href.startsWith(`${TELEGRAM_URL}?text=`), l).toBe(true);
      const msg = decodeURIComponent(href.slice(`${TELEGRAM_URL}?text=`.length));
      expect(msg, l).toContain("SellerFlowLive Website");
      expect(msg, l).not.toMatch(/upgrade|subscri|plan\b|price|NT\$/i);
      r.unmount();
    }
  });
  it("an empty message falls back to the plain chat link; no other Telegram link uses the draft", () => {
    expect(telegramDraftUrl("")).toBe(TELEGRAM_URL);
    // the only caller in the app is the teaser card (every other Telegram link keeps TELEGRAM_URL)
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : files(`${dir}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const callers = files("src").filter((f) => f !== "src/lib/telegram.ts" && readFileSync(f, "utf8").includes("telegramDraftUrl"));
    expect(callers).toEqual(["src/redesign/screens/SettingsHub.tsx"]);
    expect(readFileSync("src/redesign/screens/SettingsHub.tsx", "utf8").match(/telegramDraftUrl\(/g)).toHaveLength(1);
  });
});

const DATA: SalesHistData = {
  revenue: 61240, orders: 188, buyers: 121, aov: 326, trendUnit: "day", dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
  days: [{ d: "2026-09-01", rev: 6100, orders: 20 }], bestDay: { d: "2026-09-01", rev: 6100, orders: 20 }, topProducts: [],
  topBuyers: [], start: "2026-09-01", end: "2026-09-28",
};
const hook = (): UseSalesTab => ({ data: DATA, state: "live", range: "session", load: vi.fn(), reload: vi.fn() });

describe("Sales: the Website orders row with Soon is not tappable", () => {
  it("no link, no hover text, no pointer; a tap changes nothing and opens nothing", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByTestId, container } = render(<TProvider lang="en"><SalesTab cur="NT$" sessionStart="2026-09-01" today="2026-09-28" sales={hook()} websiteTeaser /></TProvider>);
    const row = getByTestId("sales-website-soon");
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector("a,button,[href],[title],[onclick]")).toBeNull();
    expect(row.hasAttribute("title") || row.hasAttribute("href") || row.hasAttribute("role")).toBe(false);
    expect(row.style.cursor).toBe("default");
    expect(row.textContent).toBe("🛍 Website ordersSoon");
    const before = container.innerHTML;
    fireEvent.click(row);
    fireEvent.click(row.querySelector("[data-testid=soon-badge]")!);
    expect(container.innerHTML).toBe(before);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Orders: the Website tab with Soon", () => {
  const tabs = (extra: Record<string, unknown>, onTab = vi.fn()) => render(<TProvider lang="en"><OrdersMinersTabs tab="orders" onTab={onTab} ordersLabel="Orders" {...extra} /></TProvider>);
  it("a new switch, off by default; shown only to a seller without the website, never an admin", () => {
    expect(FEATURE_SWITCH_KEYS.websiteTeaserOrders).toBe("website_teaser_orders_enabled");
    expect(SWITCHES_OFF.websiteTeaserOrders).toBe(false);
    expect(parseSwitches([{ key: "website_teaser_orders_enabled", value: "true" }]).websiteTeaserOrders).toBe(true);
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const websiteTeaserOrdersOn = websiteTeaserVisible({ switchOn: featureSw.websiteTeaserOrders, hasWebsite: sellerWebsiteOn, isAdmin });");
    expect(src.match(/websiteSoon=\{websiteTeaserOrdersOn \? tApp\.rd_wor_tab : undefined\}/g)).toHaveLength(2); // Orders + Miners headers
    expect(websiteTeaserVisible({ switchOn: true, hasWebsite: false, isAdmin: true })).toBe(false);
  });
  it("next to the tabs, looks inactive, not a button; a tap changes nothing", () => {
    const onTab = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByTestId, container } = tabs({ websiteSoon: "Website" }, onTab);
    const soon = getByTestId("orders-tab-website-soon");
    expect(soon.tagName).toBe("SPAN");
    expect(soon.querySelector("a,button,[href],[title]")).toBeNull();
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.style.cursor).toBe("default");
    expect(soon.style.opacity).toBe("0.6");
    expect(soon.style.whiteSpace).toBe("nowrap");
    expect(soon.textContent).toBe("WebsiteSoon");
    const before = container.innerHTML;
    fireEvent.click(soon);
    fireEvent.click(soon.querySelector("[data-testid=soon-badge]")!);
    expect(container.innerHTML).toBe(before);
    expect(onTab).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("the existing tabs keep their buttons and style", () => {
    const a = tabs({}); const o = a.getByTestId("orders-tab-orders").outerHTML, m = a.getByTestId("orders-tab-miners").outerHTML; a.unmount();
    const b = tabs({ websiteSoon: "Website" });
    expect(b.getByTestId("orders-tab-orders").outerHTML).toBe(o);
    expect(b.getByTestId("orders-tab-miners").outerHTML).toBe(m);
  });
  it("switch off: exactly as before; tester: the real tab, never the Soon one", () => {
    const a = tabs({}); const before = a.container.innerHTML; a.unmount();
    const b = tabs({ websiteSoon: undefined }); expect(b.container.innerHTML).toBe(before); b.unmount();
    const c = tabs({ website: { label: "Website", count: 0 } }); const tester = c.container.innerHTML; c.unmount();
    const d = tabs({ website: { label: "Website", count: 0 }, websiteSoon: "Website" });
    expect(d.container.innerHTML).toBe(tester);
    expect(d.queryByTestId("orders-tab-website-soon")).toBeNull();
  });
  it("sql/170 seeds the switch 'false' (add-only); the rollback removes only it", () => {
    const up = readFileSync("sql/170_website_teaser_orders.sql", "utf8").replace(/^--.*$/gm, "");
    expect(up).toMatch(/insert into public\.app_settings \(key, value\) values \('website_teaser_orders_enabled', 'false'\)\s*on conflict \(key\) do nothing;/);
    expect(up).not.toMatch(/\b(update|delete|drop|alter|create)\b/i);
    expect(readFileSync("sql/170_website_teaser_orders_rollback.sql", "utf8").replace(/^--.*$/gm, "").trim()).toBe("delete from public.app_settings where key = 'website_teaser_orders_enabled';");
  });
});
