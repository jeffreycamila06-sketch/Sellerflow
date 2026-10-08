// Shared render fixture for the platform-world tests: renders every screen the world can touch
// (and the ones it must not) and returns each screen's innerHTML. Called with NO world props it
// renders exactly what main renders (the same file is run against a main checkout to prove
// byte-identity). Not a test file itself.
import { render, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { TProvider } from "../../i18n";
import Dashboard from "../../screens/Dashboard";
import GeneralSettings from "../../screens/GeneralSettings";
import SettingsHub from "../../screens/SettingsHub";
import ManageChannels from "../../screens/ManageChannels";
import Orders from "../../screens/Orders";
import Miners from "../../screens/Miners";
import PrinterSettings from "../../screens/PrinterSettings";
import PrintPattern, { DEFAULT_PP } from "../../screens/PrintPattern";
import { DEF_SETTINGS } from "../printing";
import SalesTab from "../../screens/SalesTab";
import Products from "../../screens/Products";
import ReceiptFormat from "../../screens/ReceiptFormat";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls, Order } from "../../data";
import type { UseMinersReport } from "../minersReport";

const noop = () => {};
const auto: AutoControls = { detect: false, toggle: noop };
const account: AccountUser = {
  authUserId: "u1", email: "s@x.com",
  profile: { fullName: "S", storeName: "S", phone: "", tiktok: "shop_a", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "2026-12-31", connectedAccounts: ["TikTok"], role: "seller",
};
const o = (over: Partial<Order>): Order => ({
  id: "#1", buyer: "Alpha", handle: "@alpha", items: "Dress", qty: 1, total: 100, status: "New",
  platform: "TikTok", time: "1:00 PM", orderNum: 1, date: "2026-09-18", ...over,
});
const ORDERS: Order[] = [
  o({ id: "#1", buyer: "Alpha", handle: "@alpha", total: 100, platform: "TikTok", orderNum: 1 }),
  o({ id: "#2", buyer: "Bravo", handle: "@bravo", total: 250, platform: "TikTok", orderNum: 2 }),
];
const rep = (): UseMinersReport => ({
  data: {
    spent: 24500, orders: 62, buyers: 33, avg: 395, tiktokPct: 100, fbPct: 0, split: [],
    top: [{ name: "Ann Cruz", handle: "@anncruz", platform: "TikTok", spent: 12000, orders: 9, activeDays: 3, repeat: true }],
    start: "2026-09-01", end: "2026-09-19", limit: 10,
  },
  state: "live", load: vi.fn(), reload: vi.fn(),
});

export interface WorldProps {
  dash?: Record<string, unknown>;
  orders?: Record<string, unknown>;
  miners?: Record<string, unknown>;
  pinVisible?: boolean; // RedesignApp passes onTogglePinPrint only when this is true
  sales?: Record<string, unknown>;
  products?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

const SALES = {
  data: {
    revenue: 1000, orders: 5, buyers: 3, aov: 200, trendUnit: "day", dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
    days: [{ d: "2026-10-08", rev: 1000, orders: 5 }], bestDay: { d: "2026-10-08", rev: 1000, orders: 5 },
    topProducts: [], topBuyers: [{ name: "Ann", handle: "ann", spent: 1000, orders: 5 }], start: "2026-10-08", end: "2026-10-08",
  },
  state: "live", range: "today", load: () => {}, reload: () => {},
} as never;

const html = (ui: React.ReactElement): string => {
  const { container } = render(<TProvider lang="en">{ui}</TProvider>);
  const out = container.innerHTML;
  cleanup();
  return out;
};

export function renderScreens(p: WorldProps = {}): Record<string, string> {
  const pinVisible = p.pinVisible ?? true;
  return {
    dashboard: html(
      <Dashboard comments={[] as never[]} cur="NT$" ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onManageTT={noop}
        ttConnected={false} fbConnected={false} ttConnecting={false} fbConnecting={false}
        onConnectTT={noop} onRefreshTT={noop} ttAccounts={["shop_a"]} fbAccounts={[]}
        printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop}
        {...(p.dash ?? {})} />,
    ),
    dashboardFbOpen: html(
      <Dashboard comments={[] as never[]} cur="NT$" ttOpen={false} fbOpen={true} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onManageTT={noop}
        ttConnected={false} fbConnected={false} ttConnecting={false} fbConnecting={false}
        onConnectTT={noop} onRefreshTT={noop} ttAccounts={["shop_a"]} fbAccounts={[]}
        printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop}
        {...(p.dash ?? {})} />,
    ),
    generalSettings: html(
      <GeneralSettings theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
        keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={pinVisible ? noop : undefined}
        liveSessionOpen onToggleLiveSession={noop} {...(p.settings ?? {})} />,
    ),
    settingsHub: html(
      <SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onShipping={noop}
        onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} isAdmin={false} />,
    ),
    manageTikTok: html(<ManageChannels platform="tiktok" account={account} onBack={noop} onSaveChannels={async () => ({ ok: true })} />),
    manageFacebook: html(<ManageChannels platform="facebook" account={account} onBack={noop} onSaveChannels={async () => ({ ok: true })} />),
    orders: html(
      <Orders onGoPrint={noop} cur="NT$" orders={ORDERS} state="live" todayId="2026-09-18"
        buyers={[]} onReprintOrder={noop} seller={{ name: "Jeff", email: "j@x.com" }} {...(p.orders ?? {})} />,
    ),
    miners: html(<Miners cur="NT$" rep={rep()} todayId="2026-09-19" sessionStartId="2026-09-15" {...(p.miners ?? {})} />),
    printerSettings: html(
      <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="80x50mm" psSizeOpen={false}
        onTogglePsSize={noop} onPickPsSize={noop} settings={DEF_SETTINGS} stickerQrAllowed />,
    ),
    printPattern: html(<PrintPattern onBack={noop} pp={DEFAULT_PP} onToggle={noop} onStep={noop} stickerQrAllowed />),
    salesTab: html(<SalesTab cur="NT$" sessionStart="2026-10-06" today="2026-10-08" sales={SALES} {...(p.sales ?? {})} />),
    products: html(<Products cur="NT$" {...(p.products ?? {})} />),
    receiptFormat: html(<ReceiptFormat cur="NT$" onBack={noop} {...(p.receipt ?? {})} />),
  };
}
