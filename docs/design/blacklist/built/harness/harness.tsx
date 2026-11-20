// BLACKLIST — pictures of the BUILT screens (nothing here ships). Every part is the real component:
// SettingsHub (with the Blacklist tile), the Blacklist screen, the Dashboard rows with the chip and the
// dates sheet. Made-up data in memory; the add / undo / remove callbacks follow the database's rules
// (one row per buyer + reason + day). ?view=settings|bl|live|livesheet&lang=en|fil&empty=1&qr=…
import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import "../../../../../src/styles/design-tokens.css";
import "../../../../../src/redesign/redesign.css";
import { TProvider, normalizeLang } from "../../../../../src/redesign/i18n";
import SettingsHub from "../../../../../src/redesign/screens/SettingsHub";
import Dashboard from "../../../../../src/redesign/screens/Dashboard";
import Blacklist from "../../../../../src/redesign/screens/Blacklist";
import BlacklistSheet from "../../../../../src/redesign/components/BlacklistSheet";
import { blacklistKey, blacklistLabel, blacklistMap, groupBlacklist, type BlAddResult, type BlEntry, type BlPlatform, type BlReason, type BlRow } from "../../../../../src/redesign/adapters/blacklist";
import type { Comment } from "../../../../../src/redesign/data";

const qs = new URLSearchParams(location.search);
const lang = normalizeLang(qs.get("lang") || "en");
const view = qs.get("view") || "bl";
const TODAY = "2026-11-20";
let n = 100;
const R = (platform: BlPlatform, label: string, reason: BlReason, day: string): BlRow => ({ id: `r${n++}`, platform, label, reason, day, createdAt: `${day}T10:${String(n % 60).padStart(2, "0")}:00Z` });
const SEED: BlRow[] = [
  R("tiktok", "maria_shop", "returned", "2026-11-18"), R("tiktok", "maria_shop", "returned", "2026-11-02"), R("tiktok", "maria_shop", "not_checked_out", "2026-10-30"),
  R("facebook", "Ana Reyes", "not_checked_out", "2026-11-16"),
  R("tiktok", "jhunbelle.ukay", "returned", "2026-11-12"),
  R("tiktok", "kikay_mommy23", "not_checked_out", "2026-11-09"), R("tiktok", "kikay_mommy23", "not_checked_out", "2026-11-05"), R("tiktok", "kikay_mommy23", "not_checked_out", "2026-11-01"),
  R("facebook", "Ma. Cristina Dela Cruz-Villanueva", "returned", "2026-10-28"), R("facebook", "Ma. Cristina Dela Cruz-Villanueva", "not_checked_out", "2026-10-21"),
  R("tiktok", "rhea.ukay", "returned", TODAY),
];

function BlView() {
  const [rows, setRows] = useState<BlRow[]>(qs.get("empty") ? [] : SEED);
  const onAdd = async (platform: BlPlatform, raw: string, reason: BlReason): Promise<BlAddResult> => {
    const label = blacklistLabel(platform, raw), key = blacklistKey(platform, label);
    if (rows.some((r) => r.platform === platform && blacklistKey(r.platform, r.label) === key && r.reason === reason && r.day === TODAY)) return { kind: "already", day: TODAY };
    const row: BlRow = { id: `n${n++}`, platform, label, reason, day: TODAY, createdAt: `${TODAY}T23:59:${String(n % 60).padStart(2, "0")}Z` };
    setRows((x) => [row, ...x]);
    return { kind: "added", id: row.id, day: TODAY };
  };
  const onUndo = async (id: string) => { setRows((x) => x.filter((r) => r.id !== id)); return true; };
  const onRemove = async (e: BlEntry) => { setRows((x) => x.filter((r) => !(r.platform === e.platform && blacklistKey(r.platform, r.label) === e.key))); return true; };
  return <Blacklist onBack={() => {}} rows={rows} onReload={() => {}} onAdd={onAdd} onUndo={onUndo} onRemove={onRemove} />;
}

const C = (id: string, name: string, handle: string, text: string, platform: string, time: string, mine = false): Comment => ({ id, name, handle, text, mine, time, platform } as Comment);
const FEED: Comment[] = [
  C("c1", "Liza Mae", "@lizamae.ph", "magkano po ito?", "TikTok", "9:42:10 PM"),
  C("c2", "Maria Shop", "@maria_shop", "mine A", "TikTok", "9:41:58 PM", true),
  C("c3", "Ana Reyes", "Ana Reyes", "mine 2", "Facebook", "9:41:40 PM", true),
  C("c4", "Jessa", "@jessa_tiangge", "pa reserve po", "TikTok", "9:41:22 PM"),
  C("c5", "Kikay Mommy", "@kikay_mommy23", "mine B", "TikTok", "9:41:05 PM", true),
];
function LiveView({ sheet }: { sheet: boolean }) {
  const entries = useMemo(() => groupBlacklist(SEED), []);
  const map = useMemo(() => blacklistMap(entries), [entries]);
  const [open, setOpen] = useState<BlEntry | null>(sheet ? entries[0] : null);
  const noop = () => {};
  return (
    <>
      <Dashboard comments={FEED} cur="₱" historyReady ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop} ttConnected fbConnected={false} ttConnecting={false} fbConnecting={false}
        ttAccounts={["@rheasukayshop"]} fbAccounts={["Rhea Ukay Shop"]} onConnectTT={noop} onConnectFB={noop} printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop}
        blacklist={map} onBlacklistTap={setOpen} />
      {open && <BlacklistSheet entry={open} onClose={() => setOpen(null)} />}
    </>
  );
}
function SettingsView() {
  const noop = () => {};
  return <SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} onInvite={noop} onBlacklist={noop} blacklistNew={!qs.get("seen")} />;
}
function App() {
  return (
    <div data-redesign="" data-theme={qs.get("theme") || "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      {view === "settings" ? <SettingsView /> : view === "live" ? <LiveView sheet={false} /> : view === "livesheet" ? <LiveView sheet /> : <BlView />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<TProvider lang={lang}><App /></TProvider>);
