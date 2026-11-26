// Admin → Controls → "Receipt add-on" (sql/223). Every seller with the Messenger receipt: shop, email,
// plan, plan end (amber under 7 days or ended — the add-on ends with the plan), "+ Receipt", since,
// note. Search by shop / email. "+ Add seller" by email; Remove asks inside the page (no confirm());
// Remove keeps the row (enabled false). No price anywhere.
import { useContext, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import {
  addonEnded, addonEndsSoon, filterAddons, ReceiptAddonCtx, setReceiptAddon, setReceiptAddonNote,
  type AddonListState, type ReceiptAddon,
} from "../adapters/receiptAddon";

const small: CSSProperties = { fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45 };
const btn: CSSProperties = { minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 };
const btnSolid: CSSProperties = { ...btn, background: "var(--accent)", color: "var(--accent-text)" };
const btnDanger: CSSProperties = { ...btn, border: "1px solid var(--danger)", color: "var(--danger)" };
const input: CSSProperties = { flex: 1, minWidth: 0, minHeight: 44, padding: "0 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)", boxSizing: "border-box" };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "11px 12px" };
const pill: CSSProperties = { fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" };

const dateOf = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Taipei" });
};

/** The small "+ Receipt" badge next to a seller's plan in the other admin lists (needs ReceiptAddonCtx). */
export function ReceiptBadge({ email }: { email: string | null | undefined }) {
  const t = useT();
  const set = useContext(ReceiptAddonCtx);
  if (!set || !email || !set.has(email.trim().toLowerCase())) return null;
  return <span data-testid="ra-badge" style={{ ...pill, color: "var(--accent-fg)", background: "var(--accent-soft)" }}>{t.rd_adm_ra_badge}</span>;
}

function Row({ a, now, onChanged, onToast }: { a: ReceiptAddon; now: number; onChanged: () => void; onToast?: (m: string, k: "ok" | "err") => void }) {
  const t = useT();
  const [ask, setAsk] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(a.note);
  const [busy, setBusy] = useState(false);
  const ended = addonEnded(a.planExpiry, now);
  const warn = addonEndsSoon(a.planExpiry, now);
  const remove = async () => {
    setBusy(true);
    const r = await setReceiptAddon(a.email, false);
    setBusy(false); setAsk(false);
    if (r === "removed" || r === "not_enabled") { onToast?.(tpl(t.rd_adm_ra_removed, { email: a.email }), "ok"); onChanged(); }
    else onToast?.(t.rd_adm_ra_err, "err");
  };
  const saveNote = async () => {
    setBusy(true);
    const ok = await setReceiptAddonNote(a.userId, note);
    setBusy(false);
    if (ok) { setNoteOpen(false); onChanged(); } else onToast?.(t.rd_adm_ra_err, "err");
  };
  return (
    <div data-testid="ra-row" data-email={a.email} style={card}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 5 }}>
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <div data-testid="ra-shop" style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{a.shop || a.email}</div>
          <div data-testid="ra-email" style={{ fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{a.email}</div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          <span data-testid="ra-plan" style={{ ...pill, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)" }}>{a.plan || "—"}</span>
          <span data-testid="ra-row-badge" style={{ ...pill, color: "var(--accent-fg)", background: "var(--accent-soft)" }}>{t.rd_adm_ra_badge}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 6, fontSize: 12 }}>
        <span data-testid="ra-expiry" data-warn={warn ? "1" : undefined}
          style={{ fontWeight: 700, color: warn ? "var(--warn)" : "var(--text-muted)" }}>
          {!a.planExpiry ? t.rd_adm_ra_no_end : tpl(ended ? t.rd_adm_ra_ended : t.rd_adm_ra_ends, { d: dateOf(a.planExpiry) })}
        </span>
        <span data-testid="ra-since" style={{ color: "var(--text-dim)" }}>{tpl(t.rd_adm_ra_since, { d: dateOf(a.since) })}</span>
      </div>
      {!noteOpen ? (
        <button type="button" data-testid="ra-note" onClick={() => { setNote(a.note); setNoteOpen(true); }}
          style={{ display: "block", width: "100%", textAlign: "left", marginTop: 6, minHeight: 36, padding: "6px 8px", borderRadius: 8, border: "1px dashed var(--border)", background: "transparent", color: a.note ? "var(--text)" : "var(--text-dim)", fontSize: 12.5, cursor: "pointer", fontFamily: "var(--font-ui)", overflowWrap: "anywhere" }}>
          {a.note || t.rd_adm_ra_note_ph}
        </button>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <input data-testid="ra-note-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t.rd_adm_ra_note_ph} style={{ ...input, flexBasis: 180 }} />
          <button type="button" data-testid="ra-note-cancel" disabled={busy} onClick={() => setNoteOpen(false)} style={btn}>{t.rd_ref_cancel}</button>
          <button type="button" data-testid="ra-note-save" disabled={busy} onClick={() => void saveNote()} style={btnSolid}>{t.rd_adm_ra_note_save}</button>
        </div>
      )}
      {!ask ? (
        <button type="button" data-testid="ra-remove" onClick={() => setAsk(true)} style={{ ...btnDanger, marginTop: 8 }}>{t.rd_adm_ra_remove}</button>
      ) : (
        <div data-testid="ra-confirm" style={{ marginTop: 8, border: "1px solid var(--danger)", borderRadius: 10, padding: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{tpl(t.rd_adm_ra_remove_q, { email: a.email })}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" data-testid="ra-confirm-no" disabled={busy} onClick={() => setAsk(false)} style={btn}>{t.rd_ref_cancel}</button>
            <button type="button" data-testid="ra-confirm-yes" disabled={busy} onClick={() => void remove()} style={{ ...btn, background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }}>{t.rd_adm_ra_remove}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReceiptAddonPanel({ list, state, reload, onToast, now: nowProp }: { list: ReceiptAddon[]; state: AddonListState; reload: () => void; onToast?: (m: string, k: "ok" | "err") => void; now?: number }) {
  const t = useT();
  const [openedAt] = useState(() => Date.now());   // the clock when the panel opened (amber = under 7 days from then)
  const now = nowProp ?? openedAt;
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy(true);
    const r = await setReceiptAddon(e, true);
    setBusy(false);
    if (r === "added" || r === "enabled") { onToast?.(tpl(t.rd_adm_ra_added, { email: e }), "ok"); setEmail(""); setAdding(false); reload(); }
    else if (r === "already") onToast?.(tpl(t.rd_adm_ra_already, { email: e }), "ok");
    else if (r === "not_found") onToast?.(t.rd_adm_ra_not_found, "err");
    else onToast?.(t.rd_adm_ra_err, "err");
  };
  if (state === "idle" || (state === "loading" && list.length === 0)) return <div style={small} data-testid="ra-loading">{t.rd_ref_loading}</div>;
  if (state === "error") return <div style={{ ...small, color: "var(--danger)" }} data-testid="ra-error">{t.rd_adm_ra_failed}</div>;
  const shown = filterAddons(list, q);
  return (
    <div data-testid="ra-panel" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div>
        <div data-testid="ra-count" style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{list.length === 1 ? t.rd_adm_ra_count_one : tpl(t.rd_adm_ra_count, { n: list.length })}</div>
        <div style={small}>{t.rd_adm_ra_follows}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input data-testid="ra-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_adm_ra_search} style={{ ...input, flexBasis: 180 }} />
        {!adding && <button type="button" data-testid="ra-add-open" onClick={() => setAdding(true)} style={btnSolid}>{t.rd_adm_ra_add}</button>}
      </div>
      {adding && (
        <div data-testid="ra-add-form" style={{ ...card, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input data-testid="ra-add-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.rd_adm_ra_email_ph}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} style={{ ...input, flexBasis: 200 }} />
          <button type="button" data-testid="ra-add-cancel" disabled={busy} onClick={() => { setAdding(false); setEmail(""); }} style={btn}>{t.rd_ref_cancel}</button>
          <button type="button" data-testid="ra-add-go" disabled={busy || !email.trim()} onClick={() => void add()} style={{ ...btnSolid, opacity: email.trim() ? 1 : 0.6 }}>{t.rd_adm_ra_add_go}</button>
        </div>
      )}
      {list.length === 0 && <div style={small} data-testid="ra-none">{t.rd_adm_ra_none}</div>}
      {list.length > 0 && shown.length === 0 && <div style={small} data-testid="ra-no-match">{t.rd_adm_ra_no_match}</div>}
      {shown.map((a) => <Row key={a.userId} a={a} now={now} onChanged={reload} onToast={onToast} />)}
    </div>
  );
}
