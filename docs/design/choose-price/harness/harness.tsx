// The REAL Settings → Live setup and the REAL price pop-up over the REAL Live screen — for
// screenshots at phone and laptop widths (NOT part of the app build).
//   ?view=settings-off | settings-on | pop-single | pop-queued
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import GeneralSettings from "../../../../src/redesign/screens/GeneralSettings";
import Dashboard from "../../../../src/redesign/screens/Dashboard";
import ChoosePriceSheet from "../../../../src/redesign/components/ChoosePriceSheet";
import type { Comment } from "../../../../src/redesign/data";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "settings-off";
const noop = () => {};

export function Settings({ on }: { on: boolean }) {
  const [sp, setSp] = useState(!on);
  const [cp, setCp] = useState(on);
  const [prices, setPrices] = useState<number[]>(on ? [39, 59, 79, 99] : []);
  return (
    <GeneralSettings
      theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={{ detect: false, toggle: noop }} cur="₱" lang="en" onSetLang={noop} currency="PHP" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint onTogglePinPrint={noop}
      liveSessionOpen onToggleLiveSession={noop}
      printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={{ authUserId: "u1", email: "ana@shop.ph", profile: { fullName: "Ana Cruz", storeName: "Ana's Ukay", phone: "09171234567", tiktok: "anaukay", facebook: "", adminContactNote: "" }, plan: "pro", planStatus: "active", planExpiry: "2026-12-30T00:00:00Z", connectedAccounts: [], role: "seller" }}
      onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
      samePriceEnabled={sp} samePrice={39} onSetSamePriceEnabled={(o) => setSp(o)}
      choosePriceEnabled={cp} choosePrices={prices}
      onSetChoosePriceEnabled={(o, p) => { setCp(o); if (p) setPrices(p); }} onSetChoosePrices={setPrices}
      onToast={noop}
    />
  );
}

const C = (id: string, name: string, handle: string, text: string, time: string): Comment => ({ id, name, handle, text, mine: true, time, platform: "TikTok" });
const feed = [
  C("c1", "Maria Santos", "@mariasantos", "mine po #12", "8:41:02 PM"),
  C("c2", "Jen Reyes", "@jenreyes", "mine yung blue", "8:41:09 PM"),
  C("c3", "Liza Gomez", "@lizag", "mine 79", "8:41:15 PM"),
  C("c4", "Rose Tan", "@rosetan", "mine po", "8:41:22 PM"),
];
export function Pop({ queued }: { queued: boolean }) {
  // The app shows the pop-up only after a tap / pin (the page root exists by then) — same here.
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <>
      <Dashboard comments={feed} cur="₱" historyReady ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop}
        ttConnected fbConnected={false} ttConnecting={false} fbConnecting={false} onConnectTT={noop} onConnectFB={noop}
        printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop} />
      {shown && <ChoosePriceSheet item={{ key: "click:c1", kind: "click", rowId: "c1", msgId: "m1", name: "Maria Santos", handle: "mariasantos", comment: "mine po #12" }}
        prices={[39, 59, 79, 99]} cur="₱" waiting={queued ? 2 : 0} onPick={noop} onType={noop} onSkip={noop} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme="light" style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)", position: "relative" }}>
      {view.startsWith("settings") ? <Settings on={view === "settings-on"} /> : <Pop queued={view === "pop-queued"} />}
    </div>
  </TProvider>,
);
