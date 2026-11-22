// The 4-hour rule "the first swap is free" (sql/205) — the REAL "Plan full" popup and the REAL Shopee shops
// screen with the props RedesignApp passes, for screenshots (NOT part of the app build). Fake data only.
//   npx vite --config vite.preview.config.ts --port 5199
//   ?view=popup&state=one|two|locked|held   (&ios=1)   — "one": after Remove the list comes back empty (room)
//   ?view=shops&state=list|locked
//   &dark=1   &lang=en|fil|zh|zh-TW|vi|th|id|bg
// All names are made up; a Shopee shop shows only "Shopee shop ·<last 4>".
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import PlanFullPopup from "../../../../src/redesign/components/PlanFullPopup";
import ShopeeShops from "../../../../src/redesign/screens/ShopeeShops";
import type { AccountList, AccountRow, PlanFullTarget, LiveAccounts } from "../../../../src/redesign/adapters/planFull";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "popup";
const state = q.get("state") || "one";
const ios = q.get("ios") === "1";
const lang = q.get("lang") || "en";
const noop = () => {};
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const IN_3H30 = iso(NOW + (3 * 60 + 30) * 60_000 - 30_000);

const tt = (key: string, rank: number, lockUntil: string | null = null): AccountRow => ({ platform: "tiktok", key, id: null, name: null, link: false, rank, covered: true, addedAt: iso(NOW - 40 * 86_400_000), lockUntil });
const shop = (tail: string, rank: number, lockUntil: string | null = null, daysAgo = 3): AccountRow => ({ platform: "shopee", key: `ph:00000000${tail}`, id: `s${tail}`, name: null, link: true, rank, covered: true, addedAt: iso(NOW - daysAgo * 86_400_000), lockUntil });
const list = (o: Partial<AccountList>): AccountList => ({ v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: iso(NOW), loadedAt: NOW, accounts: [], ...o });
const NO_LIVE: LiveAccounts = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };

const POPUP: Record<string, { lists: AccountList[]; target: PlanFullTarget; plan: string }> = {
  // Basic, one TikTok name, the seller wants Shopee: Remove → the place is free at once
  one: { lists: [list({ accounts: [tt("budgetukay.ph", 1)] }), list({ used: 0, accounts: [] })], target: { kind: "shopee" }, plan: "Basic" },
  // Plus, two accounts; the Shopee shop took a place 30 minutes ago (locked), the TikTok name is free to remove
  two: { lists: [list({ plan: "plus", limit: 2, used: 2, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, IN_3H30, 0)] })], target: { kind: "facebook" }, plan: "Plus" },
  // Basic, the one account took its place 30 minutes ago: Remove → "Wait a little"
  locked: { lists: [list({ accounts: [shop("5678", 1, IN_3H30, 0)] })], target: { kind: "tiktok" }, plan: "Basic" },
  // a locked account was removed another way: its place is held until the 4 hours end
  held: { lists: [list({ used: 1, locked: 1, nextFreeAt: IN_3H30, accounts: [] })], target: { kind: "tiktok" }, plan: "Basic" },
};
const SHOPS: Record<string, AccountList> = {
  list: list({ plan: "pro", limit: 3, used: 3, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, null, 9), shop("1234", 3, null, 1)] }),
  locked: list({ plan: "pro", limit: 3, used: 3, accounts: [tt("budgetukay.ph", 1), shop("5678", 2, IN_3H30, 0), shop("1234", 3, null, 9)] }),
};

function screen() {
  if (view === "popup") {
    const p = POPUP[state];
    const lists = [...p.lists];
    return <PlanFullPopup target={p.target} ios={ios} planName={p.plan} live={NO_LIVE}
      onRemove={async () => ({ ok: true })} onUpgrade={noop} onClose={noop} load={async () => (lists.length > 1 ? lists.shift()! : lists[0])} />;
  }
  return <ShopeeShops list={SHOPS[state]} live={NO_LIVE} onRemove={async () => ({ ok: true })} onReload={noop} onBack={noop} />;
}

createRoot(document.getElementById("root")!).render(
  <TProvider lang={lang}>
    <div data-redesign="" data-theme={q.get("dark") === "1" ? "dark" : "light"} data-accent="indigo" style={{ color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <div className="sfl-stage"><div className="sfl-phone"><div className="sfl-scroll" data-testid="harness-scroll">
        {view === "popup" && <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Live screen behind the popup</div>}
        {screen()}
      </div></div></div>
    </div>
  </TProvider>,
);
