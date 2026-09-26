// 7-11 賣貨便 PICKUP STATUS ("Chase Buyer") — Part 5 screen.
//
// READ-ONLY. One own-scoped SELECT on open (+ a manual Refresh). ZERO app-side
// polling — the Render poller keeps parcel_tracking fresh; this screen just reads
// + groups. Phase 1 = OWNER + googletest (parcelTrackingVisible gates the tile
// AND this render in RedesignApp) — gating is NOT changed by the redesign.
//
// Layout (redesign): WEB = boxed status tabs (All · Waiting · In transit · Picked up ·
// Returned, with counts) over an aligned table (Buyer · Store · Parcel · Left · action).
// MOBILE / app shell = 2-col status count cards (tap = select) over compact rows (no
// Parcel code). Same data, same query, same grouping (groupParcels); rows sorted by
// days-left ascending (sortByDaysLeft). "Left": red when ≤2 days / returning-soon;
// "—" in transit; "Done" picked up; "Returned" returned. Action: Waiting → Chase (the
// existing Open profile / Copy username behaviour, incl. the iOS copy-on-open); no
// action otherwise (no SHOPMORE tracking link exists, so there is no Track button).
// "no username" parcels stay visible in their tab. "All" also keeps the non-chaseable
// / not-yet-updated rows (the old "Other" bucket) so nothing disappears.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { taipeiDayId } from "../../lib/dateHelpers";
import { copyText } from "../components/inviteShare";
import { syncFromExport } from "../adapters/parcelExportRead";
import {
  loadParcelTracking, type ParcelTotals, groupParcels, chaseTarget, chaseCopyValue, rowTab, leftCell, tabRows, tabCounts,
  PICKUP_TABS, PICKUP_STATUS_TABS,
  type ParcelTrackingRow, type ParcelGroups, type PickupTab,
} from "../adapters/parcelTracking";
import { isIOS } from "../adapters/platform";
import { isAppShell, isNarrowViewport } from "../adapters/appShell";

const btn: CSSProperties = { padding: "7px 12px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block", whiteSpace: "nowrap" };
const chaseBtn: CSSProperties = { ...btn, border: "1px solid var(--accent)", color: "var(--accent)", background: "transparent", padding: "6px 11px" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

type T = ReturnType<typeof useT>;

const TAB_LABEL: Record<PickupTab, "rd_pt_tab_all" | "rd_pt_tab_waiting" | "rd_pt_tab_transit" | "rd_pt_tab_picked" | "rd_pt_tab_returned"> = {
  all: "rd_pt_tab_all", waiting: "rd_pt_tab_waiting", transit: "rd_pt_tab_transit", picked: "rd_pt_tab_picked", returned: "rd_pt_tab_returned",
};

// Mobile = the app shell OR a narrow viewport (the shared 768px cutoff); re-evaluated on
// resize so a laptop window dragged narrow switches layout.
function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => isAppShell() || isNarrowViewport());
  useEffect(() => {
    const on = () => setNarrow(isAppShell() || isNarrowViewport());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

// "Left" cell text + colour (gray normally; red + medium weight when urgent).
function LeftText({ row, today, t }: { row: ParcelTrackingRow; today: string; t: T }) {
  const c = leftCell(row, today);
  let label: string;
  let urgent = false;
  if (c.kind === "done") label = t.rd_pt_left_done;
  else if (c.kind === "returned") label = t.rd_pt_left_returned;
  else if (c.kind === "none") label = "—";
  else {
    urgent = c.urgent;
    if (c.days === null) label = t.rd_pt_no_deadline;
    else if (c.days < 0) label = t.rd_pt_overdue;
    else if (c.days === 0) label = t.rd_pt_due_today;
    else if (c.days === 1) label = t.rd_pt_day_left;
    else label = tpl(t.rd_pt_days_left, { n: c.days });
  }
  return (
    <span style={{ fontSize: 12.5, fontWeight: urgent ? 600 : 400, color: urgent ? "var(--danger)" : "var(--text-dim)", ...ellipsis, display: "block" }}
      data-testid="pt-left" data-urgent={urgent ? "1" : "0"}>
      {label}
    </span>
  );
}

// Waiting → "Chase" (the EXISTING behaviour: handle-shaped → open the TikTok profile, with
// the iOS copy-on-open; otherwise copy the username; no username → nothing). Every other
// status → no action. The old button captions become tooltips.
function ChaseAction({ row, t, onCopy }: { row: ParcelTrackingRow; t: T; onCopy: (handle: string) => void }) {
  if (rowTab(row) !== "waiting") return null;
  const target = chaseTarget(row.buyerUsername);
  if (target.kind === "open") {
    // Direct link opens the TikTok app on iOS (universal link). On iOS ALSO copy
    // "@handle" on the same tap so it's ready to paste into the app's Search → profile
    // → Message (the app lands on home, but the seller is logged in). Desktop: no copy,
    // straight to the profile. Navigation is NOT prevented — the link still opens.
    const cp = chaseCopyValue(target.handle, isIOS());
    return (
      <a href={target.url} target="_blank" rel="noreferrer" style={chaseBtn} data-testid="pt-open-profile" title={t.rd_pt_open_profile}
        onClick={() => { if (cp) void onCopy(cp); }}>
        {t.rd_pt_chase}
      </a>
    );
  }
  if (target.kind === "copy") {
    return (
      <button style={chaseBtn} onClick={() => onCopy(target.handle)} data-testid="pt-copy-username" title={t.rd_pt_copy_username}>
        {t.rd_pt_chase}
      </button>
    );
  }
  return null;
}

function Buyer({ row, t }: { row: ParcelTrackingRow; t: T }) {
  const name = String(row.buyerUsername ?? "").trim();
  return name
    ? <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", ...ellipsis, display: "block" }} title={`@${name.replace(/^@+/, "")}`}>@{name.replace(/^@+/, "")}</span>
    : <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", fontStyle: "italic", ...ellipsis, display: "block" }}>{t.rd_pt_no_username}</span>;
}
const storeOf = (row: ParcelTrackingRow) => row.recStore || row.storeId || "—";

// WEB — boxed tabs (radius 8px 8px 0 0; active = accent fill + on-accent text) on a 3px
// accent rule; horizontal scroll when the row is too wide.
function Tabs({ tab, counts, onPick, t }: { tab: PickupTab; counts: Record<PickupTab, number>; onPick: (x: PickupTab) => void; t: T }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "3px solid var(--accent)", overflowX: "auto", marginBottom: 0 }} data-testid="pt-tabs">
      {PICKUP_TABS.map((x) => {
        const active = x === tab;
        return (
          <button key={x} type="button" role="tab" aria-selected={active} onClick={() => onPick(x)} data-testid={`pt-tab-${x}`}
            style={{
              padding: "8px 14px", borderRadius: "8px 8px 0 0", whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer",
              border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`, borderBottom: "none",
              background: active ? "var(--accent)" : "var(--surface-2)", color: active ? "var(--accent-text)" : "var(--text-dim)",
              fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700,
            }}>
            {t[TAB_LABEL[x]]} <span style={{ opacity: 0.85, fontWeight: 600 }}>{counts[x]}</span>
          </button>
        );
      })}
    </div>
  );
}

// WEB — aligned table (table-layout: fixed). Buyer · Store · Parcel (mono, muted) · Left · action.
function Table({ rows, today, t, onCopy }: { rows: ParcelTrackingRow[]; today: string; t: T; onCopy: (h: string) => void }) {
  const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", padding: "10px 10px 8px", textTransform: "uppercase", letterSpacing: ".04em", ...ellipsis };
  const td: CSSProperties = { padding: "10px", borderTop: "1px solid var(--border)", verticalAlign: "middle", overflow: "hidden" };
  return (
    <div style={{ ...card, padding: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }} data-testid="pt-table">
        <colgroup>
          <col style={{ width: "27%" }} /><col style={{ width: "27%" }} /><col style={{ width: "20%" }} /><col style={{ width: "14%" }} /><col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>{t.rd_pt_col_buyer}</th>
            <th style={th}>{t.rd_pt_col_store}</th>
            <th style={th}>{t.rd_pt_col_parcel}</th>
            <th style={th}>{t.rd_pt_col_left}</th>
            <th style={th} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="pt-row">
              <td style={td}><Buyer row={r} t={t} /></td>
              <td style={td}><span style={{ fontSize: 12.5, color: "var(--text)", ...ellipsis, display: "block" }} title={storeOf(r)}>{storeOf(r)}</span></td>
              <td style={td}><span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-muted)", ...ellipsis, display: "block" }} title={r.trackingNo} data-testid="pt-code">{r.trackingNo}</span></td>
              <td style={td}><LeftText row={r} today={today} t={t} /></td>
              <td style={{ ...td, textAlign: "right" }}><ChaseAction row={r} t={t} onCopy={onCopy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// MOBILE — 2-col status count cards (big number; Waiting red, Picked up green; tap to
// select; selected = 2px accent border).
function Cards({ tab, counts, onPick, t }: { tab: PickupTab; counts: Record<PickupTab, number>; onPick: (x: PickupTab) => void; t: T }) {
  const numColor = (x: PickupTab) => (x === "waiting" ? "var(--danger)" : x === "picked" ? "var(--ok)" : "var(--text)");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }} data-testid="pt-cards">
      {PICKUP_STATUS_TABS.map((x) => {
        const active = x === tab;
        return (
          <button key={x} type="button" aria-pressed={active} onClick={() => onPick(x)} data-testid={`pt-card-${x}`}
            style={{ ...card, margin: 0, padding: "12px 14px", textAlign: "left", cursor: "pointer", border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`, fontFamily: "var(--font-ui)" }}>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1, color: numColor(x) }}>{counts[x]}</div>
            {/* card space is tight → the short "Waiting pickup" label for the same status */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginTop: 4, ...ellipsis }}>{x === "waiting" ? t.rd_pt_card_waiting : t[TAB_LABEL[x]]}</div>
          </button>
        );
      })}
    </div>
  );
}

// MOBILE — compact rows: Buyer + Store (two lines) · Left · action. No parcel code.
function CompactList({ rows, today, t, onCopy }: { rows: ParcelTrackingRow[]; today: string; t: T; onCopy: (h: string) => void }) {
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }} data-testid="pt-list">
      {rows.map((r, i) => (
        <div key={r.id} data-testid="pt-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Buyer row={r} t={t} />
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, ...ellipsis }}>{storeOf(r)}</div>
          </div>
          <div style={{ flexShrink: 0, maxWidth: "34%", textAlign: "right" }}><LeftText row={r} today={today} t={t} /></div>
          <div style={{ flexShrink: 0 }}><ChaseAction row={r} t={t} onCopy={onCopy} /></div>
        </div>
      ))}
    </div>
  );
}

export default function ParcelTracking() {
  const t = useT();
  const today = taipeiDayId();
  const narrow = useNarrowLayout();
  const [tab, setTab] = useState<PickupTab>("waiting"); // the chase list first
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [groups, setGroups] = useState<ParcelGroups | null>(null);
  const [totals, setTotals] = useState<ParcelTotals | undefined>(undefined); // exact DB counts (survive the page cap)
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setState("loading");
    const res = await loadParcelTracking();
    if (!res.ok) { setState("error"); return; }
    setGroups(groupParcels(res.rows, today));
    setTotals(res.totals);
    setState("ready");
  }
  // Read-on-open ONLY (zero poll) — a refresh is a manual tap. setState lives in
  // the .then callback (not synchronously in the effect body); initial state is
  // already "loading" so mount needs no extra set. (CustomerDetails pattern.)
  useEffect(() => {
    let live = true;
    void loadParcelTracking().then((res) => {
      if (!live) return;
      if (!res.ok) { setState("error"); return; }
      setGroups(groupParcels(res.rows, today));
      setTotals(res.totals);
      setState("ready");
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCopy = async (handle: string) => {
    const ok = await copyText(handle);
    if (ok) { setToast(t.rd_pt_copied); setTimeout(() => setToast(""), 1500); }
  };

  const showToast = (msg: string, ms = 4000) => { setToast(msg); setTimeout(() => setToast(""), ms); };

  // "Sync from 賣貨便" — read the uploaded 匯出報表 .xlsx and upsert the buyer handles
  // under the seller's own JWT. Client-side parse; poller columns are never written.
  const onSyncPick = async (files: FileList | null) => {
    const file = files && files[0];
    if (fileRef.current) fileRef.current.value = ""; // re-picking the same file works
    if (!file) return;
    setSyncing(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await syncFromExport(bytes);
      if (!res.ok) { showToast(t.rd_pt_sync_err); return; }
      if (res.empty) { showToast(t.rd_pt_sync_empty); return; }
      showToast(tpl(t.rd_pt_sync_done, { n: res.synced, m: res.totalRows, k: res.without }));
      await load(); // re-read so the new @handles show immediately
    } catch { showToast(t.rd_pt_sync_err); }
    finally { setSyncing(false); }
  };

  const empty = groups && !groups.waitingPickup.length && !groups.inTransit.length && !groups.pickedUp.length && !groups.returned.length && !groups.other.length;

  return (
    <div>
      <div style={{ ...headerBar, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={headerTitle}>{t.rd_pt_title}</div>
          <div style={{ fontSize: 11.5, color: "var(--on-header)", opacity: 0.85, marginTop: 2 }}>{t.rd_pt_sub}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => fileRef.current?.click()} disabled={syncing} style={{ ...btn, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", color: "var(--on-header)", opacity: syncing ? 0.6 : 1 }} data-testid="pt-sync">
            {syncing ? t.rd_pt_sync_ing : t.rd_pt_sync}
          </button>
          <button onClick={() => void load()} style={{ ...btn, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", color: "var(--on-header)" }} data-testid="pt-refresh">
            {t.rd_pt_refresh}
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-testid="pt-sync-file" onChange={(e) => void onSyncPick(e.target.files)} />

      <div style={{ padding: 16, maxWidth: narrow ? 620 : 960, margin: "0 auto" }}>
        {/* Sync-from-賣貨便 hint + collapsible how-to (laptop-first). */}
        <div style={{ ...card, padding: 12, marginBottom: 14 }} data-testid="pt-sync-card">
          <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{t.rd_pt_sync_hint}</div>
          <button onClick={() => setShowHow((v) => !v)} style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 700 }} data-testid="pt-sync-how-toggle">
            {showHow ? t.rd_pt_sync_how_hide : t.rd_pt_sync_how}
          </button>
          {showHow && (
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }} data-testid="pt-sync-how">
              <li>{t.rd_pt_sync_s1}</li>
              <li>{t.rd_pt_sync_s2}</li>
              <li>{t.rd_pt_sync_s3}</li>
              <li>{t.rd_pt_sync_s4}</li>
            </ol>
          )}
        </div>

        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", padding: 30 }}>{t.rd_pt_loading}</div>}
        {state === "error" && <div style={{ ...card, fontSize: 13, color: "var(--danger)", textAlign: "center" }} data-testid="pt-error">{t.rd_pt_error}</div>}
        {state === "ready" && groups && (
          empty
            ? <div style={{ ...card, fontSize: 13, color: "var(--text-dim)", textAlign: "center" }} data-testid="pt-empty">{t.rd_pt_empty}</div>
            : (() => {
                const counts = tabCounts(groups, totals);
                const rows = tabRows(groups, tab, today);
                const emptyTab = <div style={{ ...card, fontSize: 12.5, color: "var(--text-dim)", textAlign: "center", padding: 16, ...(narrow ? {} : { borderTopLeftRadius: 0, borderTopRightRadius: 0 }) }} data-testid="pt-tab-empty">{t.rd_pt_tab_empty}</div>;
                return narrow
                  ? <div data-testid="pt-mobile">
                      <Cards tab={tab} counts={counts} onPick={setTab} t={t} />
                      {rows.length ? <CompactList rows={rows} today={today} t={t} onCopy={onCopy} /> : emptyTab}
                    </div>
                  : <div data-testid="pt-web">
                      <Tabs tab={tab} counts={counts} onPick={setTab} t={t} />
                      {rows.length ? <Table rows={rows} today={today} t={t} onCopy={onCopy} /> : emptyTab}
                    </div>;
              })()
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 30, transform: "translateX(-50%)", background: "var(--text)", color: "var(--surface)", padding: "9px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, zIndex: 60 }} data-testid="pt-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
