// Shopee paste box — the REAL Live screen (Dashboard + its Live picker) and the REAL paste box, with the
// props RedesignApp passes in each state, for screenshots (NOT part of the app build).
//   ?state=connecting | connected | ended | otherdevice | lastlink     ?dark=1   ?lang=en
// connecting / connected: the "Shopee Live · Change link" button with the box open (like Jeff's preview);
// ended / otherdevice / lastlink: Shopee gray → the four tiles; the picture script taps the Shopee tile.
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import Dashboard from "../../../../src/redesign/screens/Dashboard";
import type { Comment } from "../../../../src/redesign/data";
import { sessionEndLabel } from "../../../../src/redesign/adapters/sessionEnd";

const q = new URLSearchParams(location.search);
const state = q.get("state") || "connecting";
const LINK = "https://ph.shp.ee/HrRWjkYp"; // a made-up share link
const noop = () => {};
const C = (id: string, name: string, handle: string, text: string, time: string): Comment => ({ id, name, handle, text, mine: true, time, platform: "Shopee" });
const feed = state === "connected" ? [
  C("c1", "Maria Santos", "mariasantos", "mine 15", "8:41:02 PM"),
  C("c2", "Jen Reyes", "jenreyes", "mine yung blue", "8:41:09 PM"),
] : [];

const green = state === "connected";
const busy = state === "connecting";
const shopeeLink = {
  daysLeft: 23, error: null, onConnect: noop,
  connectedLink: green ? LINK : "",
  initialLink: state === "ended" ? "" : LINK,
  savedLink: state === "ended" || state === "connecting" ? "" : LINK,
  notice: state === "ended" ? "rd_sh_stop_ended" : state === "otherdevice" ? "rd_sh_stop_other_device" : null,
};

createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme={q.get("dark") === "1" ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)", position: "relative" }}>
      <Dashboard comments={feed} cur="₱" historyReady livePicker ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop} onManageTT={noop} onRefreshTT={noop}
        ttAccounts={["anaukay"]} fbAccounts={[]}
        ttConnected={false} fbConnected={false} ttConnecting={false} fbConnecting={false} onConnectTT={noop} onConnectFB={noop}
        shopeeConnected={green} shopeeConnecting={busy} shopeeOpen={green || busy} onToggleShopee={noop}
        shopeeLink={shopeeLink}
        sessionEndsAt={sessionEndLabel("2026-11-22T02:00:00Z", 1, q.get("lang") || "en")}
        printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop} />
    </div>
  </TProvider>,
);
