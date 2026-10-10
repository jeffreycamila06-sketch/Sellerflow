// Forgot password → 6-digit email code (3 steps). Shown instead of the Telegram modal when
// reset_code_enabled is on, or in an owner-preview tab (adapters/resetCode.ts).
// 1 email → Send code (same neutral answer for every email) · 2 code (auto-submit at 6
// digits, 5 wrong tries → only "Send a new code") · 3 new password → save, sign out every
// session, back to the login form with the email filled in. Closing / Back before the save
// drops the reset-only session. Never logs or stores the email, code or password.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import PasswordInput from "./PasswordInput";
import { TELEGRAM_URL } from "../../lib/telegram";
import { passwordRuleCode } from "../adapters/useAuthSession";
import {
  RESET_CODE_LEN, RESET_RESEND_SECONDS, RESET_MAX_WRONG, cleanCode,
  sendResetCode, verifyResetCode, saveNewPassword, abandonReset,
} from "../adapters/resetCode";

const input: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, outline: "none" };
const primary: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const linkBtn: CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700 };
const note = (tone: "ok" | "err"): CSSProperties => ({ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, borderRadius: 10, padding: "9px 11px", marginTop: 10,
  color: tone === "ok" ? "var(--text)" : "var(--danger)", background: tone === "ok" ? "var(--surface-2)" : "var(--danger-soft, rgba(225,29,72,.1))",
  border: `1px solid ${tone === "ok" ? "var(--border)" : "var(--danger)"}` });

type Step = "email" | "code" | "password";

export default function ResetCodeModal({ initialEmail, onClose, onDone }: {
  initialEmail: string;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<"" | "sent" | "wait">("");
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrong, setWrong] = useState(0);
  const [codeErr, setCodeErr] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [saving, setSaving] = useState(false);
  const verified = useRef(false); // a reset-only session exists on this device
  const locked = wrong >= RESET_MAX_WRONG;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  // Unmounted before the new password was saved → drop the reset-only session.
  useEffect(() => () => { if (verified.current) { verified.current = false; void abandonReset(); } }, []);

  const send = async () => {
    if (sending || cooldown > 0) return;
    if (!email.trim().includes("@")) { setSentMsg(""); setCodeErr(false); setPwErr(t.rd_pwr_email_err); return; }
    setPwErr("");
    setSending(true);
    const r = await sendResetCode(email);
    setSending(false);
    setSentMsg(r);
    setCooldown(RESET_RESEND_SECONDS);
    setWrong(0); setCodeErr(false); setCode("");
    if (r === "sent") setStep("code");
  };

  const submitCode = async (c: string) => {
    if (checking || locked || c.length !== RESET_CODE_LEN) return;
    setChecking(true);
    const ok = await verifyResetCode(email, c);
    setChecking(false);
    if (ok) { verified.current = true; setCodeErr(false); setStep("password"); return; }
    setWrong((n) => n + 1);
    setCodeErr(true);
    setCode("");
  };
  const onCode = (v: string) => {
    const c = cleanCode(v);
    setCode(c);
    if (c.length === RESET_CODE_LEN) void submitCode(c);
  };

  const save = async () => {
    if (saving) return;
    const rule = passwordRuleCode(pw, pw2);
    if (rule) { setPwErr(rule === "pw_len" ? t.rd_su_err_pw_len : t.rd_su_err_pw_match); return; }
    setPwErr("");
    setSaving(true);
    const ok = await saveNewPassword(pw);
    setSaving(false);
    if (!ok) { setPwErr(t.rd_pwr_save_err); return; }
    verified.current = false; // saveNewPassword already signed every session out
    onDone(email.trim().toLowerCase());
  };

  // Close / Back: drop the reset-only session (if any) and start over.
  const leave = async (thenClose: boolean) => {
    if (verified.current) { verified.current = false; await abandonReset(); }
    setStep("email"); setCode(""); setPw(""); setPw2(""); setPwErr(""); setCodeErr(false); setWrong(0); setSentMsg("");
    if (thenClose) onClose();
  };

  const resendLabel = cooldown > 0 ? tpl(t.rd_pwr_resend_in, { s: cooldown }) : t.rd_pwr_resend;

  return (
    <div onClick={() => void leave(true)} data-testid="pwr-backdrop"
      style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="pwr-modal"
        style={{ width: "100%", maxWidth: 340, boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", padding: "18px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>{t.rd_pwr_title}</div>
          <button onClick={() => void leave(true)} aria-label={t.rd_pwr_close} data-testid="pwr-close" style={{ background: "none", border: "none", fontSize: 18, lineHeight: 1, color: "var(--text-muted)", cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        {step === "email" && (
          <div data-testid="pwr-step-email">
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "8px 0 10px", lineHeight: 1.5 }}>{t.rd_pwr_email_sub}</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="username" placeholder={t.rd_login_email_ph} style={input} data-testid="pwr-email" />
            <button onClick={() => void send()} disabled={sending || cooldown > 0} style={{ ...primary, marginTop: 10, opacity: sending || cooldown > 0 ? 0.6 : 1 }} data-testid="pwr-send">
              {sending ? t.rd_pwr_sending : cooldown > 0 ? tpl(t.rd_pwr_resend_in, { s: cooldown }) : t.rd_pwr_send}
            </button>
            {sentMsg === "wait" && <div style={note("err")} data-testid="pwr-wait">{t.rd_pwr_wait}</div>}
            {pwErr && <div style={note("err")} data-testid="pwr-err">{pwErr}</div>}
          </div>
        )}

        {step === "code" && (
          <div data-testid="pwr-step-code">
            <div style={note("ok")} data-testid="pwr-sent">{t.rd_pwr_sent}</div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: "12px 0 6px" }}>{t.rd_pwr_code_lbl}</label>
            <input value={code} onChange={(e) => onCode(e.target.value)} disabled={locked || checking}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="••••••" aria-label={t.rd_pwr_code_lbl}
              style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 22, letterSpacing: ".35em", textAlign: "center", opacity: locked ? 0.5 : 1 }} data-testid="pwr-code" />
            {checking && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pwr_checking}</div>}
            {codeErr && !locked && <div style={note("err")} data-testid="pwr-wrong">{t.rd_pwr_wrong}</div>}
            {locked && <div style={note("err")} data-testid="pwr-locked">{t.rd_pwr_locked}</div>}
            {sentMsg === "wait" && <div style={note("err")} data-testid="pwr-wait">{t.rd_pwr_wait}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => void leave(false)} style={{ ...linkBtn, color: "var(--text-dim)" }} data-testid="pwr-back">{t.rd_pwr_back}</button>
              <button onClick={() => void send()} disabled={sending || cooldown > 0} style={{ ...linkBtn, opacity: sending || cooldown > 0 ? 0.55 : 1, cursor: cooldown > 0 ? "default" : "pointer" }} data-testid="pwr-resend">{resendLabel}</button>
            </div>
          </div>
        )}

        {step === "password" && (
          <div data-testid="pwr-step-password">
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "8px 0 10px", lineHeight: 1.5 }}>{t.rd_pwr_pw_sub}</div>
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} name="new-password" autoComplete="new-password" placeholder={t.rd_pwr_new_pw} style={input} wrapStyle={{ marginBottom: 8 }} />
            <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} name="confirm-password" autoComplete="new-password" placeholder={t.rd_pwr_confirm_pw} style={input} />
            {pwErr && <div style={note("err")} data-testid="pwr-err">{pwErr}</div>}
            <button onClick={() => void save()} disabled={saving} style={{ ...primary, marginTop: 10, opacity: saving ? 0.6 : 1 }} data-testid="pwr-save">{saving ? t.rd_pwr_saving : t.rd_pwr_save}</button>
            <div style={{ marginTop: 10 }}><button onClick={() => void leave(false)} style={{ ...linkBtn, color: "var(--text-dim)" }} data-testid="pwr-back">{t.rd_pwr_back}</button></div>
          </div>
        )}

        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" data-testid="pwr-telegram"
          style={{ display: "block", textAlign: "center", marginTop: 14, fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", textDecoration: "none" }}>{t.rd_pwr_tg}</a>
      </div>
    </div>
  );
}
