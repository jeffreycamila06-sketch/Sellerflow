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
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { taipeiDayId } from "../../lib/dateHelpers";
import { copyText } from "../components/inviteShare";
import { syncFromExport, type SyncResult } from "../adapters/parcelExportRead";
import {
  loadParcelTracking, loadMoreLive, type ParcelTotals, groupParcels, chaseTarget, chaseCopyValue, rowTab, leftCell, isUnchecked, tabRows, tabCounts,
  PICKUP_TABS, PICKUP_STATUS_TABS,
  type ParcelTrackingRow, type ParcelGroups, type PickupTab,
  loadTrackingStatus, requestCheck, checkButtonState, isStale, urgentEligible, formatTaipei, CHECK_POLL_MS,
  type TrackingStatus, type TrackingJob, type CheckResult,
  loadBuyerNamesByHandle, normHandle,
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
  if (c.kind === "unchecked") {
    // Wraps (no ellipsis) — the compact row gives this cell ≤34% width on a phone.
    return (
      <span style={{ fontSize: 11.5, color: "var(--text-muted)", display: "block", lineHeight: 1.3, whiteSpace: "normal" }}
        data-testid="pt-left" data-unchecked="1" data-urgent="0">
        {t.rd_pt_unchecked}
      </span>
    );
  }
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

// Waiting → "Chase" ONLY for a plain TikTok handle (opens the profile, with the iOS
// copy-on-open). Any other username → "Copy" (copies it). No username → "Copy" copies the
// tracking number (S6). Not checked yet / every other status → no action.
function ChaseAction({ row, t, onCopy }: { row: ParcelTrackingRow; t: T; onCopy: (handle: string) => void }) {
  if (rowTab(row) !== "waiting" || isUnchecked(row)) return null; // not checked yet → no chase
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
    // not a plain TikTok handle (IG/LINE/FB-tagged, a name, CJK) → Copy only, never a link
    return (
      <button style={chaseBtn} onClick={() => onCopy(target.handle)} data-testid="pt-copy-username" title={t.rd_pt_copy_username}>
        {t.rd_pt_copy}
      </button>
    );
  }
  // S6 — no username: still listed; Copy the tracking number so the seller can look it up
  return (
    <button style={chaseBtn} onClick={() => onCopy(row.trackingNo)} data-testid="pt-copy-code" title={t.rd_pt_copy_code}>
      {t.rd_pt_copy}
    </button>
  );
}

// buyerName (from Customer Details, matched on the handle) is DISPLAY ONLY: name on
// top, @handle under it. No match → exactly the @handle-only rendering. Chase / Copy /
// Open profile never see it (they read buyerUsername).
function Buyer({ row, t, nowMs, buyerName }: { row: ParcelTrackingRow; t: T; nowMs: number; buyerName?: string }) {
  const name = String(row.buyerUsername ?? "").trim();
  const handle = name.replace(/^@+/, "");
  const label = name && buyerName
    ? <>
        <span data-testid="pt-buyer-name" style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", ...ellipsis, display: "block" }} title={buyerName}>{buyerName}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", ...ellipsis, display: "block" }} title={`@${handle}`}>@{handle}</span>
      </>
    : name
    ? <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", ...ellipsis, display: "block" }} title={`@${name.replace(/^@+/, "")}`}>@{name.replace(/^@+/, "")}</span>
    : <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", fontStyle: "italic", ...ellipsis, display: "block" }}>{t.rd_pt_no_username}</span>;
  if (!isStale(row, nowMs)) return label;
  return (
    <>
      {label}
      <span data-testid="pt-stale" style={{ display: "inline-block", marginTop: 3, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--border-strong)", fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t.rd_pt_stale}</span>
    </>
  );
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
function Table({ rows, today, t, onCopy, nowMs, names }: { rows: ParcelTrackingRow[]; today: string; t: T; onCopy: (h: string) => void; nowMs: number; names: Map<string, string> }) {
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
              <td style={td}><Buyer row={r} t={t} nowMs={nowMs} buyerName={names.get(normHandle(r.buyerUsername))} /></td>
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
function CompactList({ rows, today, t, onCopy, nowMs, names }: { rows: ParcelTrackingRow[]; today: string; t: T; onCopy: (h: string) => void; nowMs: number; names: Map<string, string> }) {
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }} data-testid="pt-list">
      {rows.map((r, i) => (
        <div key={r.id} data-testid="pt-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Buyer row={r} t={t} nowMs={nowMs} buyerName={names.get(normHandle(r.buyerUsername))} />
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, ...ellipsis }}>{storeOf(r)}</div>
          </div>
          <div style={{ flexShrink: 0, maxWidth: "34%", textAlign: "right" }}><LeftText row={r} today={today} t={t} /></div>
          <div style={{ flexShrink: 0 }}><ChaseAction row={r} t={t} onCopy={onCopy} /></div>
        </div>
      ))}
    </div>
  );
}

// S4 — one plain-words message per upload failure cause (never "couldn't read the file"
// for a save/permission/session problem).
function syncErrorText(res: SyncResult, t: T): string {
  switch (res.error) {
    case "signed_out": return t.rd_pt_err_signed_out;
    case "permission": return t.rd_pt_err_permission;
    case "partial": return tpl(t.rd_pt_err_partial, { n: res.saved ?? 0, m: res.attempted ?? res.total });
    case "no_codes": return t.rd_pt_err_no_codes;
    case "not_export": return t.rd_pt_err_not_export;
    case "empty": return t.rd_pt_sync_empty;
    case "foreign": return tpl(t.rd_pt_err_foreign, { n: res.foreign ?? 0 });
    default: return t.rd_pt_err_network;
  }
}

// Same width in ready / checking / locked (fits the longest locale + the hourglass).
const CHECK_BTN_MIN_W = 150;

// "Checking…" while a job is active: a flipping hourglass + "Checking" with three
// pulsing dots (redesign.css .rd-pt-hg*, static under reduced motion). The visible
// label and dots are CSS-drawn inside aria-hidden spans, so the only text in the
// button is the visually-hidden i18n string — screen readers and tests read "Checking…".
function CheckingLabel({ text }: { text: string }) {
  return (
    <>
      <svg className="rd-pt-hg" data-testid="pt-hourglass" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h12M6 21h12M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l-2.4 2.3A4 4 0 0 0 8 17.5V21M16 3v3.5a4 4 0 0 1-1.6 3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2V21" />
        <path d="M9.5 18.5h5" strokeWidth="3" />
      </svg>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "baseline" }}>
        <span className="rd-pt-hg-label" data-label={text.replace(/(…|\.{3})$/, "")} />
        <span className="rd-pt-hg-dots"><i /><i /><i /></span>
      </span>
      <span className="rd-pt-sr">{text}</span>
    </>
  );
}

// Plain words for a refused Check now / urgent request.
function checkErrorText(res: CheckResult, t: T): string {
  switch (res.reason) {
    case "used_today": case "too_soon": return res.next_available_at ? tpl(t.rd_pt_next_at, { time: formatTaipei(res.next_available_at) }) : t.rd_pt_err_check;
    case "already_queued": return t.rd_pt_err_queued;
    case "disabled": return t.rd_pt_err_paused;
    case "not_eligible": return t.rd_pt_err_not_eligible;
    case "urgent_used_today": return t.rd_pt_err_urgent_used;
    default: return t.rd_pt_err_check;
  }
}

// The toast when a job finishes — real counts from the job row, never invented.
function jobDoneText(job: TrackingJob | null, t: T): string {
  if (!job) return "";
  const n = job.parcels_checked ?? 0, m = job.parcels_total ?? 0;
  if (job.status === "done" && m === 0) return t.rd_pt_job_nothing;
  if (job.status === "done") return tpl(job.error ? t.rd_pt_job_partial : t.rd_pt_job_done, { n, m });
  return t.rd_pt_job_failed;
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
  const [syncErr, setSyncErr] = useState(""); // S4: a persistent, plain-words upload error
  const [showHow, setShowHow] = useState(false);
  const [rows, setRows] = useState<ParcelTrackingRow[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const busy = !!status?.active_job;
  const showToast = (msg: string, ms = 4000) => { setToast(msg); setTimeout(() => setToast(""), ms); };

  const apply = (next: ParcelTrackingRow[], nextTotals: ParcelTotals | undefined) => {
    setNowMs(Date.now());
    setRows(next);
    setGroups(groupParcels(next, today));
    setTotals(nextTotals);
  };
  // Buyer NAMES from Customer Details — fetched AFTER the rows (never blocks them),
  // re-read whenever the visible handles change and on every refresh / Sync (load()).
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  const [namesNonce, setNamesNonce] = useState(0);
  const handlesKey = useMemo(() => [...new Set(rows.map((r) => normHandle(r.buyerUsername)).filter(Boolean))].sort().join("\n"), [rows]);
  useEffect(() => {
    if (!handlesKey) return;
    let live = true;
    void loadBuyerNamesByHandle(handlesKey.split("\n")).then((m) => { if (live) setNames(m); }, () => { /* fail open: no names */ });
    return () => { live = false; };
  }, [handlesKey, namesNonce]);
  async function load() {
    setNamesNonce((x) => x + 1);
    setState("loading");
    const res = await loadParcelTracking();
    if (!res.ok) { setState("error"); return; }
    apply(res.rows, res.totals);
    setState("ready");
  }
  // S7 — the unfinished list is paged (500 at a time); counts stay exact (totals).
  const liveLoaded = rows.filter((r) => !r.terminal).length;
  const liveRemaining = Math.max(0, (totals?.live ?? liveLoaded) - liveLoaded);
  const onLoadMore = async () => {
    setLoadingMore(true);
    const res = await loadMoreLive(liveLoaded);
    setLoadingMore(false);
    if (!res.ok) { showToast(t.rd_pt_err_network); return; }
    const have = new Set(rows.map((r) => r.id));
    apply([...rows, ...res.rows.filter((r) => !have.has(r.id))], totals);
  };
  // Read-on-open ONLY (zero poll) — a refresh is a manual tap. setState lives in
  // the .then callback (not synchronously in the effect body); initial state is
  // already "loading" so mount needs no extra set. (CustomerDetails pattern.)
  useEffect(() => {
    let live = true;
    void loadParcelTracking().then((res) => {
      if (!live) return;
      if (!res.ok) { setState("error"); return; }
      setRows(res.rows);
      setGroups(groupParcels(res.rows, today));
      setTotals(res.totals);
      setState("ready");
    });
    void loadTrackingStatus().then((st) => { if (live) setStatus(st); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a check is queued/running: re-read the small status every 15 s. When the job
  // is gone, show its real result and re-read the parcels. Nothing polls otherwise.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      void loadTrackingStatus().then((st) => {
        if (!st) return;
        setStatus(st);
        setNowMs(Date.now());
        if (!st.active_job) {
          const msg = jobDoneText(st.last_job, t);
          if (msg) showToast(msg, 5000);
          void load();
        }
      });
    }, CHECK_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const onCheck = async (kind: "manual" | "urgent") => {
    setRequesting(true);
    const res = await requestCheck(kind);
    const st = await loadTrackingStatus();
    setRequesting(false);
    if (st) { setStatus(st); setNowMs(Date.now()); }
    if (!res.ok) showToast(checkErrorText(res, t), 5000);
  };

  const onCopy = async (handle: string) => {
    const ok = await copyText(handle);
    if (ok) { setToast(t.rd_pt_copied); setTimeout(() => setToast(""), 1500); }
  };


  // "Sync from 賣貨便" — read the uploaded 匯出報表 .xlsx and sync it under the seller's own
  // JWT. Client-side parse; poller columns are never written. Every failure cause gets its
  // own plain-words message (S4) that stays on screen until the next upload or ✕.
  const onSyncPick = async (files: FileList | null) => {
    const file = files && files[0];
    if (fileRef.current) fileRef.current.value = ""; // re-picking the same file works
    if (!file) return;
    setSyncing(true);
    setSyncErr("");
    let res: SyncResult;
    try {
      res = await syncFromExport(new Uint8Array(await file.arrayBuffer()));
    } catch {
      res = { ok: false, error: "network", total: 0, fresh: 0, updated: 0, same: 0, withoutHandle: 0 };
    }
    setSyncing(false);
    if (!res.ok) {
      setSyncErr(syncErrorText(res, t));
      if (res.error === "partial") await load(); // show what did save
      return;
    }
    if (res.fresh + res.updated === 0) { showToast(tpl(t.rd_pt_sync_noop, { n: res.same })); return; }
    const done = tpl(t.rd_pt_sync_done2, { new: res.fresh, updated: res.updated, same: res.same });
    // New rows queue an automatic check server-side (trigger) — say so, and show it running.
    showToast(res.fresh > 0 ? `${done} ${t.rd_pt_autocheck}` : done, 5000);
    await load(); // re-read so the new parcels + @handles show immediately
    if (res.fresh > 0) { const st = await loadTrackingStatus(); if (st) setStatus(st); }
  };

  const empty = state === "ready" && (totals ? totals.all === 0
    : !!groups && !groups.waitingPickup.length && !groups.inTransit.length && !groups.pickedUp.length && !groups.returned.length && !groups.other.length);
  const syncButton = (onHeader: boolean) => (
    <button onClick={() => fileRef.current?.click()} disabled={syncing} data-testid={onHeader ? "pt-sync" : "pt-empty-sync"}
      style={onHeader
        ? { ...btn, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", color: "var(--on-header)", opacity: syncing ? 0.6 : 1 }
        : { ...btn, background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--accent-text)", opacity: syncing ? 0.6 : 1, marginTop: 12 }}>
      {syncing ? t.rd_pt_sync_ing : t.rd_pt_sync}
    </button>
  );

  return (
    <div>
      {/* 375px-safe (N1): the title block may shrink + wrap, the buttons wrap under it. */}
      <div style={{ ...headerBar, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }} data-testid="pt-header">
        <div style={{ minWidth: 0, flex: "1 1 160px" }}>
          <div style={{ ...headerTitle, overflowWrap: "anywhere" }}>{t.rd_pt_title}</div>
          <div style={{ fontSize: 11.5, color: "var(--on-header)", opacity: 0.85, marginTop: 2, overflowWrap: "anywhere" }}>{t.rd_pt_sub}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
          {syncButton(true)}
          <button onClick={() => void load()} style={{ ...btn, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", color: "var(--on-header)" }} data-testid="pt-refresh">
            {t.rd_pt_refresh}
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-testid="pt-sync-file" onChange={(e) => void onSyncPick(e.target.files)} />

      <div style={{ padding: 16, maxWidth: narrow ? 620 : 960, margin: "0 auto" }}>
        {/* S4 — upload error: plain words, one message per cause, stays until ✕ / next upload. */}
        {syncErr && (
          <div role="alert" style={{ ...card, padding: "10px 12px", marginBottom: 14, border: "1px solid var(--danger)", background: "var(--danger-soft)", display: "flex", gap: 10, alignItems: "flex-start" }} data-testid="pt-sync-error">
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", lineHeight: 1.45 }}>{syncErr}</div>
            <button onClick={() => setSyncErr("")} aria-label={t.rd_pt_dismiss} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
          </div>
        )}
        {/* Stage 2 — on-demand check. "Last checked" comes ONLY from last_completed_at. */}
        {state === "ready" && !empty && (() => {
          const b = checkButtonState(status, nowMs);
          const showUrgent = !busy && !!status && !status.urgent_used_today && urgentEligible(rows, today);
          return (
            <div style={{ ...card, padding: 12, marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-testid="pt-check-card">
              <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }} data-testid="pt-last-checked">
                  {status?.last_completed_at ? tpl(t.rd_pt_last_checked, { time: formatTaipei(status.last_completed_at) }) : t.rd_pt_never_checked}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 3, overflowWrap: "anywhere" }} data-testid="pt-check-sub">
                  {b.kind === "locked" ? tpl(t.rd_pt_next_at, { time: formatTaipei(b.nextAt) }) : t.rd_pt_check_note}
                </div>
                {showUrgent && (
                  <button onClick={() => void onCheck("urgent")} disabled={requesting} data-testid="pt-urgent"
                    style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 700, textAlign: "left" }}>
                    {t.rd_pt_urgent_link}
                  </button>
                )}
              </div>
              <button onClick={() => void onCheck("manual")} disabled={b.kind !== "ready" || requesting} data-testid="pt-check-now" data-state={b.kind} aria-live="polite"
                style={{ ...btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minWidth: CHECK_BTN_MIN_W, background: b.kind === "ready" ? "var(--accent)" : "var(--surface-2)", border: `1px solid ${b.kind === "ready" ? "var(--accent)" : "var(--border-strong)"}`, color: b.kind === "ready" ? "var(--accent-text)" : "var(--text-muted)", cursor: b.kind === "ready" ? "pointer" : "default", opacity: requesting ? 0.6 : 1 }}>
                {b.kind === "busy" ? <CheckingLabel text={t.rd_pt_checking} /> : t.rd_pt_check_now}
              </button>
            </div>
          );
        })()}
        {/* Sync-from-賣貨便 hint + collapsible how-to (laptop-first). Hidden on the empty
            state, which carries its own 3 steps + Sync button (N2). */}
        {!empty && <div style={{ ...card, padding: 12, marginBottom: 14 }} data-testid="pt-sync-card">
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
        </div>}

        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", padding: 30 }}>{t.rd_pt_loading}</div>}
        {state === "error" && <div style={{ ...card, fontSize: 13, color: "var(--danger)", textAlign: "center" }} data-testid="pt-error">{t.rd_pt_error}</div>}
        {state === "ready" && groups && (
          empty
            ? <div style={{ ...card, padding: 16 }} data-testid="pt-empty">
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{t.rd_pt_empty_title}</div>
                <ol style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7 }} data-testid="pt-empty-steps">
                  <li>{t.rd_pt_empty_s1}</li>
                  <li>{t.rd_pt_empty_s2}</li>
                  <li>{t.rd_pt_empty_s3}</li>
                </ol>
                {syncButton(false)}
              </div>
            : (() => {
                const counts = tabCounts(groups, totals);
                const tabList = tabRows(groups, tab, today);
                // S7 — more unfinished parcels than the first page: offer the next page.
                const more = liveRemaining > 0 && tab !== "picked" && tab !== "returned"
                  ? <button onClick={() => void onLoadMore()} disabled={loadingMore} style={{ ...btn, width: "100%", marginTop: 10, opacity: loadingMore ? 0.6 : 1 }} data-testid="pt-load-more">
                      {loadingMore ? t.rd_pt_loading : tpl(t.rd_pt_load_more, { n: liveRemaining })}
                    </button>
                  : null;
                const emptyTab = <div style={{ ...card, fontSize: 12.5, color: "var(--text-dim)", textAlign: "center", padding: 16, ...(narrow ? {} : { borderTopLeftRadius: 0, borderTopRightRadius: 0 }) }} data-testid="pt-tab-empty">{t.rd_pt_tab_empty}</div>;
                return narrow
                  ? <div data-testid="pt-mobile">
                      <Cards tab={tab} counts={counts} onPick={setTab} t={t} />
                      {tabList.length ? <CompactList rows={tabList} today={today} t={t} onCopy={onCopy} nowMs={nowMs} names={names} /> : emptyTab}
                      {more}
                    </div>
                  : <div data-testid="pt-web">
                      <Tabs tab={tab} counts={counts} onPick={setTab} t={t} />
                      {tabList.length ? <Table rows={tabList} today={today} t={t} onCopy={onCopy} nowMs={nowMs} names={names} /> : emptyTab}
                      {more}
                    </div>;
              })()
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 30, transform: "translateX(-50%)", width: "max-content", maxWidth: "calc(100vw - 32px)", textAlign: "center", background: "var(--text)", color: "var(--surface)", padding: "9px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, zIndex: 60 }} data-testid="pt-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
