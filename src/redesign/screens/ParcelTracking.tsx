// 7-11 賣貨便 PICKUP STATUS ("Chase Buyer") — Part 5 screen.
//
// READ-ONLY. One own-scoped SELECT on open (+ a manual Refresh). ZERO app-side
// polling — the Render poller keeps parcel_tracking fresh; this screen just reads
// + groups. Phase 1 = OWNER + googletest (parcelTrackingVisible gates the tile
// AND this render in RedesignApp).
//
// Groups: 🔴 Waiting pickup (at_store; urgent-first when returning-soon or the
// deadline is ≤2 days) · 🚚 In transit · ✅ Picked up · ⚠️ Returned · a muted
// "Other" bucket for non-chaseable (home delivery / return service) or not-yet-
// updated rows. Chase is MANUAL: a handle-shaped buyer_username → Open profile
// (tiktok.com/@handle, NOT a DM); otherwise Copy username; no username → the
// parcel still shows (code + store + status + deadline), labelled "no username".
import { useEffect, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { taipeiDayId } from "../../lib/dateHelpers";
import { copyText } from "../components/inviteShare";
import {
  loadParcelTracking, groupParcels, chaseTarget, daysUntilDate, isUrgent, isReturningSoon,
  DEADLINE_BUCKETS, deadlineBucketCounts, filterByDeadline,
  type ParcelTrackingRow, type ParcelGroups, type DeadlineBucket,
} from "../adapters/parcelTracking";

const btn: CSSProperties = { padding: "7px 12px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block", whiteSpace: "nowrap" };
const chaseBtn: CSSProperties = { ...btn, border: "1px solid var(--accent)", color: "var(--accent)", background: "transparent" };

type T = ReturnType<typeof useT>;

function DeadlineChip({ row, today, t }: { row: ParcelTrackingRow; today: string; t: T }) {
  const dl = daysUntilDate(row.pickupDeadline, today);
  const urgent = isUrgent(row, today);
  let label: string;
  if (dl === null) label = t.rd_pt_no_deadline;
  else if (dl < 0) label = t.rd_pt_overdue;
  else if (dl === 0) label = t.rd_pt_due_today;
  else if (dl === 1) label = t.rd_pt_day_left;
  else label = tpl(t.rd_pt_days_left, { n: dl });
  return (
    <span style={{ fontSize: 12, fontWeight: 800, color: urgent ? "var(--danger)" : "var(--text-dim)", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function ChaseAction({ row, t, onCopy }: { row: ParcelTrackingRow; t: T; onCopy: (handle: string) => void }) {
  const target = chaseTarget(row.buyerUsername);
  if (target.kind === "open") {
    return (
      <a href={target.url} target="_blank" rel="noreferrer noopener" style={chaseBtn} data-testid="pt-open-profile">
        {t.rd_pt_open_profile}
      </a>
    );
  }
  if (target.kind === "copy") {
    return (
      <button style={btn} onClick={() => onCopy(target.handle)} data-testid="pt-copy-username">
        {t.rd_pt_copy_username}
      </button>
    );
  }
  return null;
}

function Row({ row, today, t, onCopy, urgentFlag }: { row: ParcelTrackingRow; today: string; t: T; onCopy: (handle: string) => void; urgentFlag: boolean }) {
  const store = row.recStore || row.storeId || "—";
  const hasName = !!(row.buyerUsername && row.buyerUsername.trim());
  return (
    <div style={{ ...card, padding: 12, display: "flex", alignItems: "center", gap: 10, ...(urgentFlag ? { borderColor: "var(--danger)", background: "var(--danger-soft)" } : {}) }} data-testid="pt-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {hasName
            ? <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", wordBreak: "break-word" }}>@{String(row.buyerUsername).replace(/^@+/, "")}</span>
            : <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", fontStyle: "italic" }}>{t.rd_pt_no_username}</span>}
          {urgentFlag && <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "var(--danger)", borderRadius: 6, padding: "1px 6px" }}>{isReturningSoon(row.statusMessage) ? t.rd_pt_returning_soon : t.rd_pt_urgent}</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 3, wordBreak: "break-word" }}>
          {store} · <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{row.trackingNo}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <DeadlineChip row={row} today={today} t={t} />
        <ChaseAction row={row} t={t} onCopy={onCopy} />
      </div>
    </div>
  );
}

function Group({ emoji, title, rows, today, t, onCopy, urgentAware = false }: {
  emoji: string; title: string; rows: ParcelTrackingRow[]; today: string; t: T; onCopy: (handle: string) => void; urgentAware?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", margin: "0 2px 8px" }}>
        {emoji} {title} <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>· {rows.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => <Row key={r.id} row={r} today={today} t={t} onCopy={onCopy} urgentFlag={urgentAware && isUrgent(r, today)} />)}
      </div>
    </div>
  );
}

// Deadline filter chips → i18n label keys (count badge appended in render).
const BUCKET_LABEL: Record<DeadlineBucket, "rd_pk_all" | "rd_pk_d5" | "rd_pk_d3" | "rd_pk_d1" | "rd_pk_overdue"> = {
  all: "rd_pk_all", d5: "rd_pk_d5", d3: "rd_pk_d3", d1: "rd_pk_d1", overdue: "rd_pk_overdue",
};
function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "5px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
    background: active ? "var(--accent)" : "var(--surface-2)",
    color: active ? "#fff" : "var(--text-dim)",
    fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700,
  };
}

// 🔴 Waiting-pickup section: the status group PLUS the chase-point deadline filter
// chips (All · 5 days · 3 days · 1 day · Overdue, each with a count). The chips
// filter ONLY this section; the header count stays the section total. Terminal
// groups (picked up / returned) have no chips. Self-contained bucket state.
function WaitingSection({ waiting, today, t, onCopy }: { waiting: ParcelTrackingRow[]; today: string; t: T; onCopy: (handle: string) => void }) {
  const [bucket, setBucket] = useState<DeadlineBucket>("all");
  if (!waiting.length) return null;
  const counts = deadlineBucketCounts(waiting, today);
  const rows = filterByDeadline(waiting, bucket, today);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", margin: "0 2px 8px" }}>
        🔴 {t.rd_pt_grp_waiting} <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>· {waiting.length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }} data-testid="pt-deadline-chips">
        {DEADLINE_BUCKETS.map((b) => (
          <button key={b} type="button" onClick={() => setBucket(b)} aria-pressed={bucket === b} style={chipStyle(bucket === b)} data-testid={`pt-chip-${b}`}>
            {t[BUCKET_LABEL[b]]} · {counts[b]}
          </button>
        ))}
      </div>
      {rows.length
        ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r) => <Row key={r.id} row={r} today={today} t={t} onCopy={onCopy} urgentFlag={isUrgent(r, today)} />)}
          </div>
        : <div style={{ ...card, fontSize: 12.5, color: "var(--text-dim)", textAlign: "center", padding: 14 }} data-testid="pt-deadline-empty">
            {tpl(t.rd_pk_none, { label: t[BUCKET_LABEL[bucket]] })}
          </div>}
    </div>
  );
}

export default function ParcelTracking() {
  const t = useT();
  const today = taipeiDayId();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [groups, setGroups] = useState<ParcelGroups | null>(null);
  const [toast, setToast] = useState("");

  async function load() {
    setState("loading");
    const res = await loadParcelTracking();
    if (!res.ok) { setState("error"); return; }
    setGroups(groupParcels(res.rows, today));
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
      setState("ready");
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCopy = async (handle: string) => {
    const ok = await copyText(handle);
    if (ok) { setToast(t.rd_pt_copied); setTimeout(() => setToast(""), 1500); }
  };

  const empty = groups && !groups.waitingPickup.length && !groups.inTransit.length && !groups.pickedUp.length && !groups.returned.length && !groups.other.length;

  return (
    <div>
      <div style={{ ...headerBar, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={headerTitle}>{t.rd_pt_title}</div>
          <div style={{ fontSize: 11.5, color: "var(--on-header)", opacity: 0.85, marginTop: 2 }}>{t.rd_pt_sub}</div>
        </div>
        <button onClick={() => void load()} style={{ ...btn, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", color: "var(--on-header)" }} data-testid="pt-refresh">
          {t.rd_pt_refresh}
        </button>
      </div>

      <div style={{ padding: 16, maxWidth: 620, margin: "0 auto" }}>
        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", padding: 30 }}>{t.rd_pt_loading}</div>}
        {state === "error" && <div style={{ ...card, fontSize: 13, color: "var(--danger)", textAlign: "center" }} data-testid="pt-error">{t.rd_pt_error}</div>}
        {state === "ready" && groups && (
          empty
            ? <div style={{ ...card, fontSize: 13, color: "var(--text-dim)", textAlign: "center" }} data-testid="pt-empty">{t.rd_pt_empty}</div>
            : <>
                <WaitingSection waiting={groups.waitingPickup} today={today} t={t} onCopy={onCopy} />
                <Group emoji="🚚" title={t.rd_pt_grp_transit} rows={groups.inTransit} today={today} t={t} onCopy={onCopy} />
                <Group emoji="✅" title={t.rd_pt_grp_picked} rows={groups.pickedUp} today={today} t={t} onCopy={onCopy} />
                <Group emoji="⚠️" title={t.rd_pt_grp_returned} rows={groups.returned} today={today} t={t} onCopy={onCopy} />
                {!!groups.other.length && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 2px 6px" }}>{t.rd_pt_other_note}</div>
                    <Group emoji="📦" title={t.rd_pt_grp_other} rows={groups.other} today={today} t={t} onCopy={onCopy} />
                  </div>
                )}
              </>
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
