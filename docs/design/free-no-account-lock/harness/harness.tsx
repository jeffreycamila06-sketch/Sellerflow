// Free plan: no 4-hour account lock (sql/216) — the REAL Manage TikTok channels screen, the REAL "Plan full"
// popup and the REAL Shopee shops screen, for screenshots (NOT part of the app build). Fake data only.
//   npx vite --config vite.preview.config.ts --port 5199
//   ?view=manage&plan=free&fnl=free&quota=1,1     a free seller (the database answers "no wait")
//   ?view=manage&plan=basic&fnl=paid&quota=1,1    a paid seller 30 minutes after a change (for comparison)
//   ?view=popup&plan=free | basic     ?view=shops&plan=free
//   &dark=1   &lang=en|fil|zh|zh-TW|vi|th|id|bg   &ios=1
// All names are made up.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import ManageChannels from "../../../../src/redesign/screens/ManageChannels";
import PlanFullPopup from "../../../../src/redesign/components/PlanFullPopup";
import ShopeeShops from "../../../../src/redesign/screens/ShopeeShops";
import type { AccountUser } from "../../../../src/accountDb";
import type { AccountList, AccountRow, LiveAccounts } from "../../../../src/redesign/adapters/planFull";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "manage";
const plan = q.get("plan") || "free";
const ios = q.get("ios") === "1";
const lang = q.get("lang") || "en";
const noop = () => {};
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const IN_3H30 = iso(NOW + (3 * 60 + 30) * 60_000 - 30_000);
const free = plan === "free";
const NO_LIVE: LiveAccounts = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };
const tt = (key: string, lockUntil: string | null = null): AccountRow => ({ platform: "tiktok", key, id: null, name: null, link: false, rank: 1, covered: true, addedAt: iso(NOW - 40 * 86_400_000), lockUntil });
const shop = (lockUntil: string | null = null): AccountRow => ({ platform: "shopee", key: "ph:000000005678", id: "s5678", name: null, link: true, rank: 1, covered: true, addedAt: iso(NOW - 86_400_000), lockUntil });
// what my_account_list answers: a free seller → no_lock, no lock time; a paid seller 30 minutes after a swap → the lock
const list = (accounts: AccountRow[]): AccountList => ({ v2: true, plan, limit: 1, unlimited: false, used: accounts.length, locked: 0, nextFreeAt: null, serverNow: iso(NOW), loadedAt: NOW, accounts, noLock: free });

// eslint-disable-next-line react-refresh/only-export-components -- a picture harness, not app code
function Manage() {
  const [name, setName] = useState("budgetukay.ph");
  const account = { authUserId: "u", email: "seller@example.com", profile: { fullName: "", storeName: "Budget Ukay", phone: "", tiktok: name, facebook: "", adminContactNote: "" },
    plan, planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller" } as unknown as AccountUser;
  return <ManageChannels platform="tiktok" account={account} onBack={noop}
    onSaveChannels={async (lists) => { setName(lists.tiktok); return { ok: true }; }} />;
}

function screen() {
  if (view === "manage") return <Manage />;
  if (view === "popup") {
    const lists = [list([free ? tt("budgetukay.ph") : tt("budgetukay.ph", IN_3H30)]), { ...list([]), used: 0 }];
    return <PlanFullPopup target={{ kind: "shopee" }} ios={ios} planName={free ? "Free" : "Basic"} live={q.get("live") === "1" ? { ...NO_LIVE, tiktok: "budgetukay.ph" } : NO_LIVE}
      onRemove={async () => ({ ok: true })} onUpgrade={noop} onClose={noop} load={async () => (lists.length > 1 ? lists.shift()! : lists[0])} />;
  }
  return <ShopeeShops list={list([shop(free ? null : IN_3H30)])} live={NO_LIVE} onRemove={async () => ({ ok: true })} onReload={noop} onBack={noop} />;
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
