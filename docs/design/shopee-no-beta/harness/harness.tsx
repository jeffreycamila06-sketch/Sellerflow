// Shopee without "Beta" — the REAL Live screen tiles (Dashboard + its Live picker) and the REAL Settings → Channels
// boxes, for pictures and a fit check of the new texts (NOT part of the app build).
//   ?state=days | freelock | ended | grid   &lang=en|fil|zh|zh-TW|vi|th|id|bg   &dark=1
// days     = Shopee access on: the tile line "Shopee access · 23 days left", no badge
// freelock = Shopee access on a free plan: TikTok / Facebook / Instagram tiles locked with the new line
// ended    = Shopee access ended: the Shopee tile locked with the new line
// grid     = the four Channels boxes: Shopee open (no chip) + a second grid with Shopee ended
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, buildT } from "../../../../src/redesign/i18n";
import Dashboard from "../../../../src/redesign/screens/Dashboard";
import ChannelsGrid from "../../../../src/redesign/components/ChannelsGrid";

const q = new URLSearchParams(location.search);
const state = q.get("state") || "days";
const lang = q.get("lang") || "en";
const t = buildT(lang) as unknown as Record<string, string>;
const noop = () => {};

const shopeeLink = state === "ended" ? undefined : { daysLeft: state === "freelock" ? 5 : 23, error: null, onConnect: noop, connectedLink: "", initialLink: "", savedLink: "", notice: null };
const lock = t.rd_sh_lock_beta_only;
const platformLocks = state === "freelock" ? { TikTok: lock, Facebook: lock, Instagram: lock } : state === "ended" ? { Shopee: t.rd_sh_lock_ended } : undefined;

function body() {
  if (state === "grid") {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <ChannelsGrid input={{ tiktokNames: ["budgetukay.ph"], facebookName: null, instagram: { open: false, name: null }, shopee: { state: "open", name: "Shopee shop ·5678" } }} onOpen={noop} />
        <ChannelsGrid input={{ tiktokNames: ["budgetukay.ph"], facebookName: null, instagram: { open: false, name: null }, shopee: { state: "locked", name: null, lockText: t.rd_sh_lock_ended } }} onOpen={noop} />
      </div>
    );
  }
  return (
    <Dashboard comments={[]} cur="₱" historyReady livePicker ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
      onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop} onManageTT={noop} onRefreshTT={noop}
      ttAccounts={["anaukay"]} fbAccounts={[]}
      ttConnected={false} fbConnected={false} ttConnecting={false} fbConnecting={false} onConnectTT={noop} onConnectFB={noop}
      shopeeConnected={false} shopeeConnecting={false} shopeeOpen={false} onToggleShopee={noop}
      {...(shopeeLink ? { shopeeLink } : {})}
      {...(platformLocks ? { platformLocks } : {})}
      printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop} />
  );
}

createRoot(document.getElementById("root")!).render(
  <TProvider lang={lang}>
    <div data-redesign="" data-theme={q.get("dark") === "1" ? "dark" : "light"} data-accent="indigo" style={{ color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <div className="sfl-stage"><div className="sfl-phone"><div className="sfl-scroll" data-testid="harness-scroll">
        {body()}
      </div></div></div>
    </div>
  </TProvider>,
);
