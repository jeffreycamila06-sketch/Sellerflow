// Account limits v2 (sql/199 preview) — the REAL "Plan full" popup, the REAL Settings screen with the four
// Channels boxes and the REAL Shopee shops screen, with the props RedesignApp passes, for screenshots
// (NOT part of the app build). Run with the preview config (fake database):
//   npx vite --config vite.preview.config.ts --port 5199
//   ?view=popup&state=basic1|plus2|wait|live|notcovered   (&ios=1)
//   ?view=settings&state=ronald|beta|admin|today
//   ?view=shops&state=list|live|wait|empty   (&quota=used,limit,locked for the "Accounts used" line)
//   &dark=1   &lang=en
// All names are made up; a Shopee shop shows only "Shopee shop ·<last 4>".
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import PlanFullPopup from "../../../../src/redesign/components/PlanFullPopup";
import GeneralSettings from "../../../../src/redesign/screens/GeneralSettings";
import ShopeeShops from "../../../../src/redesign/screens/ShopeeShops";
import type { AccountList, AccountRow, PlanFullTarget, LiveAccounts } from "../../../../src/redesign/adapters/planFull";
import type { GridInput } from "../../../../src/redesign/adapters/channelsGrid";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "popup";
const state = q.get("state") || "basic1";
const ios = q.get("ios") === "1";
const lang = q.get("lang") || "en";
const noop = () => {};
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const tt = (key: string, rank: number, covered = true): AccountRow => ({ platform: "tiktok", key, id: null, name: null, link: false, rank, covered, addedAt: iso(NOW - 40 * 86_400_000) });
const fb = (rank: number): AccountRow => ({ platform: "facebook", key: "100000000000001", id: "p1", name: "Budget Ukay PH", link: false, rank, covered: true, addedAt: iso(NOW - 20 * 86_400_000) });
const shop = (tail: string, rank: number, covered = true, daysAgo = 3): AccountRow => ({ platform: "shopee", key: `ph:00000000${tail}`, id: `s${tail}`, name: null, link: true, rank, covered, addedAt: iso(NOW - daysAgo * 86_400_000) });
const list = (o: Partial<AccountList>): AccountList => ({ v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: iso(NOW), loadedAt: NOW, accounts: [], ...o });
const NO_LIVE: LiveAccounts = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };

const POPUP: Record<string, { list: AccountList; target: PlanFullTarget; plan: string; live?: LiveAccounts }> = {
  // 1 — Basic, one account, adding a second TikTok name
  basic1: { list: list({ accounts: [tt("budgetukay.ph", 1)] }), target: { kind: "tiktok" }, plan: "Basic" },
  // 3 — Plus, two accounts, connecting a new Shopee shop
  plus2: { list: list({ plan: "plus", limit: 2, used: 2, accounts: [tt("budgetukay.ph", 1), shop("5678", 2)] }), target: { kind: "shopee" }, plan: "Plus" },
  // 4 — an account was removed 1h45m ago: a different new one waits (live countdown)
  wait: { list: list({ used: 1, locked: 1, nextFreeAt: iso(NOW + (2 * 60 + 15) * 60_000 - 30_000), accounts: [] }), target: { kind: "tiktok" }, plan: "Basic" },
  // 5 — Pro, three accounts, the TikTok name is live right now; connecting a Facebook Page
  live: { list: list({ plan: "pro", limit: 3, used: 3, accounts: [tt("budgetukay.ph", 1), fb(2), shop("5678", 3)] }), target: { kind: "facebook" }, plan: "Pro", live: { ...NO_LIVE, tiktok: "budgetukay.ph" } },
  // Seller A after the copy: Basic, TikTok covered, the Shopee shop outside the plan, trying to go live with it
  notcovered: { list: list({ used: 2, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, false)] }), target: { kind: "live", name: "Shopee shop ·5678" }, plan: "Basic" },
};

const GRID: Record<string, GridInput> = {
  // a preview seller without Shopee beta: Shopee = Coming soon (like the Live tile)
  ronald: { tiktokNames: ["budgetukay.ph"], facebookName: null, instagram: { open: false, name: null }, shopee: { state: "soon", name: null } },
  // a Shopee beta seller with one shop registered
  beta: { tiktokNames: ["budgetukay.ph"], facebookName: "Budget Ukay PH", instagram: { open: false, name: null }, shopee: { state: "open", name: "Shopee shop ·5678" } },
  // admin: Instagram open
  admin: { tiktokNames: ["a_very_long_tiktok_username_for_the_box"], facebookName: null, instagram: { open: true, name: null }, shopee: { state: "open", name: null } },
};

const SHOPS: Record<string, { list: AccountList | null; live?: LiveAccounts }> = {
  list: { list: list({ plan: "pro", limit: 3, used: 3, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, true, 9), shop("1234", 3, false, 1)] }) },
  live: { list: list({ plan: "pro", limit: 3, used: 3, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, true, 9), shop("1234", 3, true, 1)] }), live: { ...NO_LIVE, shopeeUid: "000000005678" } },
  wait: { list: list({ plan: "pro", limit: 3, used: 3, locked: 1, nextFreeAt: iso(NOW + (2 * 60 + 15) * 60_000 - 30_000), accounts: [tt("budgetukay.ph", 1), shop("5678", 2, true, 9)] }) },
  empty: { list: list({ plan: "pro", limit: 3, used: 1, accounts: [tt("budgetukay.ph", 1)] }) },
};

function screen() {
  if (view === "popup") {
    const p = POPUP[state];
    return <PlanFullPopup target={p.target} ios={ios} planName={p.plan} live={p.live ?? NO_LIVE}
      onRemove={async () => ({ ok: true })} onUpgrade={noop} onClose={noop} load={async () => p.list} />;
  }
  if (view === "shops") {
    const s = SHOPS[state];
    return <ShopeeShops list={s.list} live={s.live ?? NO_LIVE} onRemove={async () => ({ ok: true })} onReload={noop} onBack={noop} />;
  }
  return (
    <GeneralSettings theme={q.get("dark") === "1" ? "dark" : "light"} accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={{ detect: false, toggle: noop }} lang={lang} onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop} printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop} onManageChannel={noop}
      channelsGrid={state === "today" ? undefined : { input: GRID[state], onOpen: noop }} />
  );
}

createRoot(document.getElementById("root")!).render(
  <TProvider lang={lang}>
    <div data-redesign="" data-theme={q.get("dark") === "1" ? "dark" : "light"} data-accent="indigo" style={{ color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      {/* the app's own frame (RedesignApp): stage → phone column → the scroll box every screen sits in */}
      <div className="sfl-stage"><div className="sfl-phone"><div className="sfl-scroll" data-testid="harness-scroll">
        {view === "popup" && <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Live screen behind the popup</div>}
        {screen()}
      </div></div></div>
    </div>
  </TProvider>,
);
