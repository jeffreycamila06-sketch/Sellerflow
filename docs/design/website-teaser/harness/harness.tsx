// Website teaser — screenshot harness (NOT part of the app build). Renders the REAL Settings and Sales
// screens with the props RedesignApp passes for each case, computed by the same gates:
//   ?who=nontester&sw=on | ?who=nontester&sw=off | ?who=tester   (&screen=settings|sales)
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import SettingsHub from "../../../../src/redesign/screens/SettingsHub";
import SalesTab from "../../../../src/redesign/screens/SalesTab";
import { sellerWebsiteVisible, websiteTeaserVisible } from "../../../../src/redesign/adapters/sellerWebsiteGate";
import type { SalesHistData } from "../../../../src/redesign/adapters/salesReport";

const q = new URLSearchParams(location.search);
const tester = q.get("who") === "tester";
const sw = q.get("sw") === "on";
const screen = q.get("screen") || "settings";
// the same gates as RedesignApp: website access = switch (off) or the tester key; teaser = its switch
const hasWebsite = sellerWebsiteVisible(false, tester);
const teaser = websiteTeaserVisible({ switchOn: sw, hasWebsite, isAdmin: false });
const teaserSales = websiteTeaserVisible({ switchOn: sw, hasWebsite, isAdmin: false });
const noop = () => {};
const DATA: SalesHistData = {
  revenue: 61240, orders: 188, buyers: 121, aov: 326, trendUnit: "day", dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
  days: [{ d: "2026-11-10", rev: 6100, orders: 20 }, { d: "2026-11-11", rev: 11200, orders: 40 }, { d: "2026-11-12", rev: 5200, orders: 18 }, { d: "2026-11-13", rev: 9300, orders: 31 }, { d: "2026-11-14", rev: 12100, orders: 37 }, { d: "2026-11-15", rev: 8040, orders: 22 }, { d: "2026-11-16", rev: 9300, orders: 20 }],
  bestDay: { d: "2026-11-14", rev: 12100, orders: 37 }, topProducts: [],
  topBuyers: [{ name: "Maria Santos", handle: "maria_shops", spent: 5820, orders: 14 }, { name: "Anne Lim", handle: "annelim", spent: 3990, orders: 9 }],
  start: "2026-11-10", end: "2026-11-16",
};
const sales = { data: DATA, state: "live" as const, range: "session" as const, load: noop, reload: noop };
const website = hasWebsite ? async () => ({ orders: 6, revenue: 2380, buyers: 5, days: [] }) : undefined;

createRoot(document.getElementById("root")!).render(
  <TProvider lang="en">
    <div data-redesign="" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      {screen === "sales"
        ? <SalesTab cur="NT$" sessionStart="2026-11-10" today="2026-11-16" sales={sales} website={website} websiteTeaser={teaserSales} />
        : <SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} onInvite={noop}
            onWebsite={hasWebsite ? noop : undefined} websiteTeaser={teaser} />}
    </div>
  </TProvider>,
);
