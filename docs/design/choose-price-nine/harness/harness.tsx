// 9 prices — the REAL Settings → Live setup and the REAL price pop-up over the REAL Live screen,
// for screenshots at phone and laptop widths (NOT part of the app build). Copied from
// docs/design/choose-price-free/harness (same props as the app passes).
//   ?view=settings | pop   ?on=1 (settings: Choose price ON)   ?free=1 (Show Free button ON)   ?dark=1
//   ?cur=₱ | NT$          ?prices=50,80,…                   ?wait=2 (pop: "2 more waiting")
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, buildT } from "../../../../src/redesign/i18n";
import GeneralSettings from "../../../../src/redesign/screens/GeneralSettings";
import Dashboard from "../../../../src/redesign/screens/Dashboard";
import ChoosePriceSheet from "../../../../src/redesign/components/ChoosePriceSheet";
import type { Comment } from "../../../../src/redesign/data";
import type { Comment as ProdComment } from "../../../../src/lib/orderTypes";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "settings";
const cur = q.get("cur") || "₱";
const prices = (q.get("prices") || "50,80,100,120,150,180,200,250,300").split(",").map(Number);
const noop = () => {};
const free0 = q.get("free") === "1";

export function Settings({ on }: { on: boolean }) {
  const [sp, setSp] = useState(!on);
  const [cp, setCp] = useState(on);
  const [list, setList] = useState<number[]>(on ? prices : []);
  const [free, setFree] = useState(free0);
  return (
    <GeneralSettings
      theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={{ detect: false, toggle: noop }} cur={cur} lang="en" onSetLang={noop} currency="PHP" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint onTogglePinPrint={noop}
      liveSessionOpen onToggleLiveSession={noop}
      printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={{ authUserId: "u1", email: "ana@shop.ph", profile: { fullName: "Ana Cruz", storeName: "Ana's Ukay", phone: "09171234567", tiktok: "anaukay", facebook: "", adminContactNote: "" }, plan: "pro", planStatus: "active", planExpiry: "2026-12-30T00:00:00Z", connectedAccounts: [], role: "seller" }}
      onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
      samePriceEnabled={sp} samePrice={39} onSetSamePriceEnabled={(o) => { setSp(o); return true; }}
      choosePriceEnabled={cp} choosePrices={list}
      onSetChoosePriceEnabled={(o, p) => { setCp(o); if (p) setList(p); return true; }} onSetChoosePrices={setList}
      chooseShowFree={free} onSetChooseShowFree={setFree}
      onToast={noop}
    />
  );
}

const C = (id: string, name: string, handle: string, text: string, time: string): Comment => ({ id, name, handle, text, mine: true, time, platform: "TikTok" });
const feed = [
  C("c1", "Maria Santos", "@mariasantos", "mine 15 ❤", "8:41:02 PM"),
  C("c2", "Jen Reyes", "@jenreyes", "mine yung blue", "8:41:09 PM"),
  C("c3", "Liza Gomez", "@lizag", "mine 79", "8:41:15 PM"),
  C("c4", "Rose Tan", "@rosetan", "mine po", "8:41:22 PM"),
];
export function Pop() {
  // The app shows the pop-up only after a tap / pin (the page root exists by then) — same here.
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  const answer = q.get("answer") || "ordered";
  return (
    <>
      <Dashboard comments={feed} cur={cur} historyReady ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop}
        ttConnected fbConnected={false} ttConnecting={false} fbConnecting={false} onConnectTT={noop} onConnectFB={noop}
        printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop} />
      {shown && <ChoosePriceSheet item={{ key: "click:c1", kind: "click", rowId: "c1", msgId: "m1", name: "Maria Santos", handle: "mariasantos", comment: "mine 15 ❤", source: { comment: "mine 15 ❤" } as ProdComment, soldOutOk: false }}
        prices={prices} cur={cur} waiting={Number(q.get("wait") || 0)}
        onPick={(_p, ok) => (answer === "blocked" ? "blocked" : answer === "soldout" && !ok ? { soldOut: "A1" } : "ordered")}
        onSkip={noop} blockedText={buildT("en").rd_sess_order_blocked} showFree={free0} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme={q.get("dark") === "1" ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)", position: "relative" }}>
      {view === "settings" ? <Settings on={q.get("on") === "1"} /> : <Pop />}
    </div>
  </TProvider>,
);
