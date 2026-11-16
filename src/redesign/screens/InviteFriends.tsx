// Settings → Invite friends (sql/165). One read per open (my_referral_summary), zero poll.
//   • no code yet  → choose-code card (own word with a live check, or "Give me a random code"),
//                    in-page warning before saving ("can't be changed"), then Save.
//   • has a code   → the code BIG + Copy + Share, this month's days line, the invites list.
//   • "Invited by a friend? Enter code" only while I have no inviter AND never had a paid plan.
// iPhone app: no prices, no buy links, and neutral words (no "subscribe" / "paid plan").
// CODE ONLY — nothing here builds or reads a link with a code in it.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { HeaderWithBack } from "../components/BackButton";
import { copyText, INVITE_URL } from "../components/inviteShare";
import {
  claimReferral, inviteCodeAvailable, inviteCodeFormatOk, loadReferralSummary, normInviteCode, randomInviteCode,
  setMyInviteCode, shareTextFor, typedInviteCode, checkInviteCode, type InviteRow, type ReferralSummary,
} from "../adapters/invite";
import { useInviteCodeCheck } from "../adapters/useInviteCodeCheck";

const h2: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text)" };
const sub: CSSProperties = { fontSize: 12.5, color: "var(--text-dim)", marginTop: 5, lineHeight: 1.5 };
const codeInput: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: mono, fontSize: 16, fontWeight: 700, letterSpacing: ".08em", outline: "none" };
const primary: CSSProperties = { width: "100%", minHeight: 46, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const secondary: CSSProperties = { ...primary, background: "var(--surface-2)", color: "var(--accent-fg)", border: "1px solid var(--border-strong)" };
const pill = (bg: string, fg: string): CSSProperties => ({ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "4px 9px", borderRadius: 999, background: bg, color: fg, whiteSpace: "nowrap" });

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Taipei" });
};

function StatusPill({ row, ios }: { row: InviteRow; ios: boolean }) {
  const t = useT();
  if (row.status === "rewarded") return <span style={pill("rgba(16,185,129,.14)", "var(--ok)")}>{tpl(t.rd_ref_st_days, { n: row.days })}</span>;
  if (row.status === "no_reward") return <span style={pill("var(--surface-3, var(--surface-2))", "var(--text-dim)")}>{ios ? t.rd_ref_st_noreward_ios : t.rd_ref_st_noreward}</span>;
  if (row.status === "revoked") return <span style={pill("var(--danger-soft, rgba(225,29,72,.1))", "var(--danger)")}>{t.rd_ref_st_revoked}</span>;
  return <span style={pill("var(--accent-soft)", "var(--accent-fg)")}>{t.rd_ref_st_linked}</span>;
}

export default function InviteFriends({ onBack, ios = false }: { onBack?: () => void; ios?: boolean }) {
  const t = useT();
  const [sum, setSum] = useState<ReferralSummary | null | "loading" | "error">("loading");
  // One read per open (zero poll). The effect only sets state in the .then (never synchronously).
  const fetchSum = useCallback(() => { void loadReferralSummary().then((s) => setSum(s ?? "error")); }, []);
  const reload = useCallback(() => { setSum("loading"); fetchSum(); }, [fetchSum]);
  useEffect(() => {
    let alive = true;
    void loadReferralSummary().then((s) => { if (alive) setSum(s ?? "error"); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <div style={headerBar}>
        <HeaderWithBack onBack={onBack}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_inv_title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_ref_sub}</div>
        </HeaderWithBack>
      </div>
      <div style={{ padding: "16px 14px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {sum === "loading" && <div style={{ ...card, fontSize: 13, color: "var(--text-muted)" }} data-testid="inv-loading">{t.rd_ref_loading}</div>}
        {sum === "error" && (
          <div style={card} data-testid="inv-error">
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t.rd_ref_load_failed}</div>
            <button type="button" onClick={reload} style={{ ...secondary, marginTop: 12 }}>{t.rd_ref_retry}</button>
          </div>
        )}
        {sum && typeof sum === "object" && (
          <>
            {sum.code ? <MyCode code={sum.code} monthDays={sum.monthDays} eligible={sum.eligible} ios={ios} />
              : <ChooseCode onSaved={fetchSum} />}
            {sum.canEnterCode && <EnterInviterCode onSaved={fetchSum} />}
            {sum.code && <InviteList rows={sum.invites} ios={ios} />}
          </>
        )}
        <ShareApp />
      </div>
    </div>
  );
}

// ── no code yet: choose one ──────────────────────────────────────────────────────────────
function ChooseCode({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const [val, setVal] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const check = useInviteCodeCheck(val, inviteCodeAvailable);
  const formatOk = inviteCodeFormatOk(val);
  const problem = check.kind === "done" ? check.value : null; // null = the check failed → the save decides
  const canSave = formatOk && check.kind !== "checking" && (problem === "" || problem === null) && !busy;
  const reasonText = (r: string | undefined) =>
    r === "taken" ? t.rd_ref_taken : r === "reserved" ? t.rd_ref_reserved : r === "format" ? t.rd_ref_format : t.rd_ref_save_failed;

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr("");
    const r = await setMyInviteCode(normInviteCode(val));
    setBusy(false);
    if (r.ok || r.reason === "already_set") { onSaved(); return; }
    setConfirming(false);
    setErr(reasonText(r.reason));
  };

  let stateLine = t.rd_ref_choose_desc, stateColor = "var(--text-muted)";
  if (val && !formatOk) { stateLine = t.rd_ref_format; stateColor = "var(--warn)"; }
  else if (check.kind === "checking") stateLine = t.rd_ref_checking;
  else if (problem === "") { stateLine = t.rd_ref_avail; stateColor = "var(--ok)"; }
  else if (problem) { stateLine = reasonText(problem); stateColor = "var(--danger)"; }

  return (
    <div style={card} data-testid="inv-choose">
      <div style={h2}>{t.rd_ref_choose_h}</div>
      <div style={sub}>{t.rd_ref_choose_desc}</div>
      <input value={val} onChange={(e) => { setVal(typedInviteCode(e.target.value)); setConfirming(false); setErr(""); }}
        placeholder={t.rd_ref_code_ph} aria-label={t.rd_ref_choose_h} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
        maxLength={12} data-testid="inv-code-input" style={{ ...codeInput, marginTop: 12 }} />
      <div data-testid="inv-code-state" style={{ fontSize: 12, fontWeight: 600, color: stateColor, marginTop: 6, lineHeight: 1.4 }}>{val ? stateLine : " "}</div>
      <button type="button" data-testid="inv-random" onClick={() => { setVal(randomInviteCode()); setConfirming(false); setErr(""); }} style={{ ...secondary, marginTop: 10 }}>🎲 {t.rd_ref_random}</button>
      {err && <div data-testid="inv-save-err" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", marginTop: 10 }}>{err}</div>}
      {!confirming ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", marginTop: 12, lineHeight: 1.45 }}>🔒 {t.rd_ref_lock}</div>
          <button type="button" data-testid="inv-save" disabled={!canSave} onClick={() => setConfirming(true)} style={{ ...primary, marginTop: 10, opacity: canSave ? 1 : 0.55, cursor: canSave ? "pointer" : "default" }}>{t.rd_ref_save}</button>
        </>
      ) : (
        <div data-testid="inv-confirm" role="alertdialog" style={{ marginTop: 12, border: "1px solid var(--warn)", background: "rgba(245,158,11,.1)", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{tpl(t.rd_ref_confirm_q, { code: normInviteCode(val) })}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" data-testid="inv-confirm-no" disabled={busy} onClick={() => setConfirming(false)} style={{ ...secondary, flex: 1 }}>{t.rd_ref_cancel}</button>
            <button type="button" data-testid="inv-confirm-yes" disabled={busy} onClick={() => void save()} style={{ ...primary, flex: 1 }}>{busy ? t.rd_ref_saving : t.rd_ref_confirm_yes}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── has a code: show it ──────────────────────────────────────────────────────────────────
function MyCode({ code, monthDays, eligible, ios }: { code: string; monthDays: number; eligible: boolean; ios: boolean }) {
  const t = useT();
  const [note, setNote] = useState<"" | "copied" | "failed">("");
  const flash = (n: "copied" | "failed") => { setNote(n); window.setTimeout(() => setNote(""), 2000); };
  const onCopy = async () => flash((await copyText(code)) ? "copied" : "failed");
  const onShare = async () => {
    const text = shareTextFor(code, t.rd_ref_share_text);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ text }); return; } catch (e) { if ((e as { name?: string } | null)?.name === "AbortError") return; }
    }
    flash((await copyText(text)) ? "copied" : "failed");
  };
  return (
    <div style={{ ...card, textAlign: "center" }} data-testid="inv-mycode">
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".04em" }}>{t.rd_ref_your_code}</div>
      <div data-testid="inv-code" style={{ fontFamily: mono, fontWeight: 800, fontSize: "clamp(26px, 9vw, 38px)", letterSpacing: ".1em", color: "var(--accent-fg)", marginTop: 6, overflowWrap: "anywhere", lineHeight: 1.15 }}>{code}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" data-testid="inv-copy" onClick={() => void onCopy()} style={{ ...secondary, flex: 1 }}>{t.rd_ref_copy}</button>
        <button type="button" data-testid="inv-share" onClick={() => void onShare()} style={{ ...primary, flex: 1 }}>{t.rd_ref_share}</button>
      </div>
      <div style={{ minHeight: 18, fontSize: 12, fontWeight: 700, marginTop: 8, color: note === "failed" ? "var(--danger)" : "var(--ok)" }} data-testid="inv-copy-note">
        {note === "copied" ? t.rd_ref_copied : note === "failed" ? t.rd_ref_copy_failed : ""}
      </div>
      {monthDays > 0 && <div data-testid="inv-month" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.45, marginTop: 4 }}>{tpl(ios ? t.rd_ref_month_ios : t.rd_ref_month, { n: monthDays })}</div>}
      {!eligible && <div data-testid="inv-paid-only" style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 6 }}>{ios ? t.rd_ref_paid_only_ios : t.rd_ref_paid_only}</div>}
    </div>
  );
}

function InviteList({ rows, ios }: { rows: InviteRow[]; ios: boolean }) {
  const t = useT();
  return (
    <div style={card} data-testid="inv-list">
      <div style={h2}>{t.rd_ref_list_h}</div>
      {rows.length === 0 ? <div style={sub}>{t.rd_ref_none}</div> : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {rows.map((r, i) => (
            <div key={`${r.email}-${r.date}-${i}`} data-testid="inv-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{fmtDate(r.date)}</div>
              </div>
              <StatusPill row={r} ios={ios} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── "Invited by a friend? Enter code" (no time limit; hidden once linked / after a paid plan) ─
function EnterInviterCode({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const check = useInviteCodeCheck(val, checkInviteCode);
  const formatOk = inviteCodeFormatOk(val);
  const canSave = formatOk && !busy && !(check.kind === "done" && check.value === false);
  const reasonText = (r: string | undefined) =>
    r === "not_found" ? t.rd_ref_not_found : r === "self" ? t.rd_ref_err_self : r === "already_linked" ? t.rd_ref_err_linked
      : r === "already_paid" ? t.rd_ref_err_paid : t.rd_ref_save_failed;
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setMsg(null);
    const r = await claimReferral(val, "settings");
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: t.rd_ref_enter_ok }); window.setTimeout(onSaved, 1200); return; }
    setMsg({ ok: false, text: reasonText(r.reason) });
    if (r.reason === "already_linked" || r.reason === "already_paid") window.setTimeout(onSaved, 1500);
  };
  const stateText = check.kind === "checking" ? t.rd_ref_checking : check.kind === "done" && check.value === true ? t.rd_ref_found
    : check.kind === "done" && check.value === false ? t.rd_ref_not_found : " ";
  const stateColor = check.kind === "done" && check.value === true ? "var(--ok)" : check.kind === "done" && check.value === false ? "var(--danger)" : "var(--text-muted)";
  return (
    <div style={card} data-testid="inv-enter">
      <div style={h2}>{t.rd_ref_enter_h}</div>
      <div style={sub}>{t.rd_ref_enter_desc}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={val} onChange={(e) => { setVal(typedInviteCode(e.target.value)); setMsg(null); }} placeholder={t.rd_ref_code_ph} aria-label={t.rd_ref_enter_h}
          autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={12} data-testid="inv-enter-input" style={{ ...codeInput, flex: 1, minWidth: 0 }} />
        <button type="button" data-testid="inv-enter-save" disabled={!canSave} onClick={() => void save()} style={{ ...primary, width: "auto", padding: "0 16px", flexShrink: 0, opacity: canSave ? 1 : 0.55, cursor: canSave ? "pointer" : "default" }}>{busy ? t.rd_ref_saving : t.rd_ref_enter_btn}</button>
      </div>
      <div data-testid="inv-enter-state" style={{ fontSize: 12, fontWeight: 600, color: msg ? (msg.ok ? "var(--ok)" : "var(--danger)") : stateColor, marginTop: 6, lineHeight: 1.4 }}>{msg ? msg.text : stateText}</div>
    </div>
  );
}

// The plain "share the app" action the old card did (landing page, no code, no reward words).
function ShareApp() {
  const t = useT();
  const [note, setNote] = useState("");
  const onShare = async () => {
    const message = t.rd_inv_share;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ text: message, url: INVITE_URL }); return; } catch (e) { if ((e as { name?: string } | null)?.name === "AbortError") return; }
    }
    const ok = await copyText(`${message} ${INVITE_URL}`);
    setNote(ok ? t.rd_inv_copied : t.rd_inv_copy_failed);
    window.setTimeout(() => setNote(""), 2500);
  };
  return (
    <div>
      <button type="button" data-testid="inv-share-app" onClick={() => void onShare()} style={{ ...secondary }}>{t.rd_ref_share_app}</button>
      {note && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginTop: 6, textAlign: "center" }}>{note}</div>}
    </div>
  );
}
