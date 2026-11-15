// Admin parts of Invite friends (sql/164). Every confirm is a step INSIDE the page (no confirm()).
//   • SellerInviteRow      Manage sellers card: the seller's code + "Change code", and the line that
//                          says what a paid plan would give their inviter. DISPLAY ONLY for the
//                          plan — giving a plan works exactly as before (the reward is the database
//                          trigger's job).
//   • InviteRewardsPanel   "Invite rewards": the current Taipei month + the next 5, days each.
//   • InviteHistoryPanel   "Invite history": inviter → friend, days, date, status, Revoke.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { mono } from "../ui";
import {
  adminRevokeReferral, adminSetInviteCode, referralLine, canRevoke, expiryAfterRevoke, rewardDaysValid, REWARD_DAYS_MAX, inviteCodeFormatOk, loadReferralHistory, loadRewardMonths, normInviteCode,
  saveRewardMonth, typedInviteCode, type HistoryRow, type ReferralPreview, type RewardMonth,
} from "../adapters/invite";

const small: CSSProperties = { fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 };
const btn: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", background: "var(--surface)", border: "1px solid var(--accent)", padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 30 };
const btnSolid: CSSProperties = { ...btn, color: "var(--accent-text)", background: "var(--accent)" };
const box: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1.3px solid var(--border-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--text)", fontFamily: mono, fontSize: 16, fontWeight: 700, outline: "none" };
const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Taipei" });
};

export function SellerInviteRow({ userId, preview, onChanged, onToast }: { userId: string; preview: ReferralPreview | undefined; onChanged: () => void; onToast?: (m: string, k: "ok" | "err") => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const line = referralLine(t as unknown as Record<string, string>, preview);
  const code = preview?.code || null;
  const save = async () => {
    setBusy(true); setErr("");
    const r = await adminSetInviteCode(userId, val);
    setBusy(false);
    if (r.ok) { setEditing(false); setConfirm(false); onToast?.(tpl(t.rd_adm_ref_changed, { code: r.code || normInviteCode(val) }), "ok"); onChanged(); return; }
    setConfirm(false);
    setErr(r.reason === "taken" ? t.rd_ref_taken : r.reason === "reserved" ? t.rd_ref_reserved : r.reason === "format" ? t.rd_ref_format : t.rd_adm_ref_err);
  };
  return (
    <div data-testid="adm-invite" style={{ marginTop: 8 }}>
      {line && (
        <div data-testid="adm-invite-line" data-tone={line.tone} style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, overflowWrap: "anywhere", marginBottom: 6, color: line.tone === "ok" ? "var(--ok)" : "var(--text-dim)" }}>
          {line.tone === "ok" ? "🎁 " : ""}{line.text}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...small }}>
        <span><span style={{ color: "var(--text-muted)" }}>{t.rd_adm_ref_code}</span>{" "}
          <span data-testid="adm-invite-code" style={{ fontFamily: mono, fontWeight: 700, color: code ? "var(--text)" : "var(--text-muted)" }}>{code || t.rd_adm_ref_no_code}</span></span>
        {!editing && <button type="button" data-testid="adm-invite-change" onClick={() => { setEditing(true); setVal(code || ""); setErr(""); }} style={{ ...btn, marginLeft: "auto" }}>{t.rd_adm_ref_change}</button>}
      </div>
      {editing && (
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 6 }}>
          <input value={val} onChange={(e) => { setVal(typedInviteCode(e.target.value)); setConfirm(false); setErr(""); }} maxLength={12} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label={t.rd_adm_ref_change} data-testid="adm-invite-input" style={box} />
          <div style={{ ...small, color: "var(--warn)" }}>{t.rd_adm_ref_change_warn}</div>
          {err && <div style={{ ...small, color: "var(--danger)", fontWeight: 700 }}>{err}</div>}
          {!confirm ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => { setEditing(false); setConfirm(false); }} style={btn}>{t.rd_ref_cancel}</button>
              <button type="button" data-testid="adm-invite-save" disabled={!inviteCodeFormatOk(val) || normInviteCode(val) === code} onClick={() => setConfirm(true)} style={{ ...btnSolid, opacity: inviteCodeFormatOk(val) && normInviteCode(val) !== code ? 1 : 0.5 }}>{t.rd_ref_save}</button>
            </div>
          ) : (
            <div data-testid="adm-invite-confirm" style={{ border: "1px solid var(--warn)", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{code ? `${code} → ${normInviteCode(val)}` : normInviteCode(val)}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                <button type="button" disabled={busy} onClick={() => setConfirm(false)} style={btn}>{t.rd_ref_cancel}</button>
                <button type="button" data-testid="adm-invite-confirm-yes" disabled={busy} onClick={() => void save()} style={btnSolid}>{busy ? t.rd_ref_saving : t.rd_ref_confirm_yes}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// "2026-11-01" → "Nov 2026" (the month is the database's first day; no time zone shift).
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map((x) => parseInt(x, 10));
  if (!y || !mo) return m;
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
};

export function InviteRewardsPanel() {
  const t = useT();
  const [rows, setRows] = useState<RewardMonth[] | null | "error">(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ month: string; ok: boolean } | null>(null);
  const apply = useCallback((r: RewardMonth[] | null) => {
    setRows(r ?? "error");
    if (r) setVals(Object.fromEntries(r.map((m) => [m.month, m.days ? String(m.days) : ""])));
  }, []);
  const load = useCallback(() => { void loadRewardMonths().then(apply); }, [apply]);
  useEffect(() => {
    let alive = true;
    void loadRewardMonths().then((r) => { if (alive) apply(r); });
    return () => { alive = false; };
  }, [apply]);
  const save = async (month: string) => {
    setBusy(month); setNote(null);
    if (!rewardDaysValid(vals[month] ?? "")) return;
    const n = vals[month] ? parseInt(vals[month], 10) : 0;
    const r = await saveRewardMonth(month, Number.isFinite(n) ? n : 0);
    setBusy("");
    setNote({ month, ok: r.ok });
    if (r.ok) load();
  };
  if (rows === null) return <div style={small}>{t.rd_ref_loading}</div>;
  if (rows === "error") return <div style={{ ...small, color: "var(--danger)" }} data-testid="ir-error">{t.rd_adm_ih_failed}</div>;
  return (
    <div data-testid="ir-panel">
      <div style={{ ...small, marginBottom: 12 }}>{t.rd_adm_ir_desc}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((m) => {
          const saved = m.days ?? 0;
          const typed = vals[m.month] ?? "";
          const valid = rewardDaysValid(typed);
          const changed = (typed ? parseInt(typed, 10) : 0) !== saved;
          const canSave = changed && valid && busy !== m.month;
          return (
            <div key={m.month} data-testid="ir-row" style={{ padding: "10px 12px", border: `1px solid ${!valid ? "var(--danger)" : m.isNow ? "var(--accent)" : "var(--border)"}`, borderRadius: 11, background: "var(--surface-2)" }}>
             <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{monthLabel(m.month)}{m.isNow && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: "var(--accent-text)", background: "var(--accent)", padding: "2px 7px", borderRadius: 6 }}>{t.rd_adm_ir_now}</span>}</div>
                <div style={{ ...small, marginTop: 2 }}>{saved > 0 ? `+${saved} ${t.rd_adm_ir_days}` : t.rd_adm_ir_off}{note?.month === m.month ? (note.ok ? ` · ${t.rd_adm_ir_saved}` : ` · ${t.rd_adm_ref_err}`) : ""}</div>
              </div>
              <input value={typed} onChange={(e) => setVals((v) => ({ ...v, [m.month]: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) }))} inputMode="numeric" placeholder="0" aria-label={`${monthLabel(m.month)} ${t.rd_adm_ir_days}`} data-testid="ir-days" style={{ ...box, width: 64, textAlign: "center" }} />
              <button type="button" data-testid="ir-save" disabled={!canSave} onClick={() => void save(m.month)} style={{ ...btnSolid, minHeight: 36, opacity: canSave ? 1 : 0.45 }}>{t.rd_adm_ir_save}</button>
             </div>
             {!valid && <div data-testid="ir-max" style={{ ...small, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{tpl(t.rd_adm_ir_max, { n: REWARD_DAYS_MAX })}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InviteHistoryPanel({ onToast }: { onToast?: (m: string, k: "ok" | "err") => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ total: number; rows: HistoryRow[] } | null | "error">(null);
  const [ask, setAsk] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (search: string, more = false, have: HistoryRow[] = []) => {
    const r = await loadReferralHistory(search, 50, more ? have.length : 0);
    if (!r) { setData("error"); return; }
    setData({ total: r.total, rows: more ? [...have, ...r.rows] : r.rows });
  }, []);
  useEffect(() => {
    const h = window.setTimeout(() => void load(q), 300);
    return () => window.clearTimeout(h);
  }, [q, load]);
  const revoke = async (row: HistoryRow) => {
    setBusy(true);
    const r = await adminRevokeReferral(row.id);
    setBusy(false); setAsk("");
    if (r.ok) { onToast?.(tpl(t.rd_adm_ih_revoked, { n: r.daysRemoved ?? 0 }), "ok"); void load(q); }
    else onToast?.(t.rd_adm_ref_err, "err");
  };
  const statusText = (r: HistoryRow) => r.status === "rewarded" ? tpl(t.rd_ref_st_days, { n: r.rewardDays })
    : r.status === "revoked" ? t.rd_ref_st_revoked : r.status === "no_reward" ? t.rd_ref_st_noreward : t.rd_ref_st_linked;
  const skipText = (s: string | null) => s === "month_off" ? t.rd_adm_ref_r_month_off : s === "inviter_not_paid" ? t.rd_adm_ref_r_inviter_not_paid
    : s === "not_first_plan" ? t.rd_adm_ref_r_not_first : s === "inviter_gone" ? t.rd_adm_ref_r_gone : s === "not_applied" ? t.rd_adm_ref_r_not_applied : "";
  return (
    <div data-testid="ih-panel">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_adm_ih_search} aria-label={t.rd_adm_ih_search} data-testid="ih-search" style={{ ...box, fontFamily: "var(--font-ui)", fontWeight: 600, marginBottom: 10 }} />
      {data === null && <div style={small}>{t.rd_ref_loading}</div>}
      {data === "error" && <div style={{ ...small, color: "var(--danger)" }} data-testid="ih-error">{t.rd_adm_ih_failed}</div>}
      {data && typeof data === "object" && (
        <>
          <div style={{ ...small, fontWeight: 700, marginBottom: 8 }}>{tpl(t.rd_adm_ih_total, { n: data.total })}</div>
          {data.rows.length === 0 && <div style={small}>{t.rd_adm_ih_empty}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.rows.map((r) => (
              <div key={r.id} data-testid="ih-row" style={{ border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface-2)", padding: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                  {r.inviterEmail || "—"}{r.inviterCode ? <span style={{ fontFamily: mono, color: "var(--text-muted)" }}> ({r.inviterCode})</span> : null}
                  <span style={{ color: "var(--text-muted)" }}> → </span>{r.inviteeEmail || "—"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: r.status === "rewarded" ? "rgba(16,185,129,.14)" : r.status === "revoked" ? "var(--danger-soft, rgba(225,29,72,.1))" : "var(--surface)", color: r.status === "rewarded" ? "var(--ok)" : r.status === "revoked" ? "var(--danger)" : "var(--text-dim)", border: "1px solid var(--border)" }}>{statusText(r)}</span>
                  <span style={small}>{fmtDay(r.rewardedAt || r.createdAt)}</span>
                  {r.status === "no_reward" && skipText(r.skipReason) && <span style={small}>· {skipText(r.skipReason)}</span>}
                  {canRevoke(r) && ask !== r.id && <button type="button" data-testid="ih-revoke" onClick={() => setAsk(r.id)} style={{ ...btn, marginLeft: "auto", color: "var(--danger)", borderColor: "var(--danger)" }}>{t.rd_adm_ih_revoke}</button>}
                </div>
                {ask === r.id && canRevoke(r) && (
                  <div data-testid="ih-confirm" style={{ marginTop: 8, border: "1px solid var(--danger)", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{tpl(t.rd_adm_ih_revoke_q, { n: r.rewardDays, email: r.inviterEmail || "—" })}</div>
                    <div data-testid="ih-expiry" style={{ ...small, marginTop: 4 }}>{r.inviterExpiry ? tpl(t.rd_adm_ih_expiry, { from: fmtDay(r.inviterExpiry), to: fmtDay(expiryAfterRevoke(r.inviterExpiry, r.rewardDays)) }) : t.rd_adm_ih_no_expiry}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                      <button type="button" disabled={busy} onClick={() => setAsk("")} style={btn}>{t.rd_ref_cancel}</button>
                      <button type="button" data-testid="ih-confirm-yes" disabled={busy} onClick={() => void revoke(r)} style={{ ...btnSolid, background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }}>{t.rd_adm_ih_revoke_yes}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {data.rows.length < data.total && <button type="button" onClick={() => void load(q, true, data.rows)} style={{ ...btn, width: "100%", marginTop: 10, minHeight: 40 }}>{t.rd_adm_ih_more}</button>}
        </>
      )}
    </div>
  );
}
