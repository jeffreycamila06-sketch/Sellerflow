// Screen 5 — Login / Landing (pre-auth, no bottom nav). dc.html v3 L284–376.
// v3: a "Forgot password?" modal (admin-only reset → Telegram redirect).
import { useState, type CSSProperties } from "react";
import { LANGS } from "../data";
import { useT } from "../i18n";
import PasswordInput from "../components/PasswordInput";
import { TELEGRAM_HANDLE, TELEGRAM_URL } from "../../lib/telegram";

const card: CSSProperties = { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: 11, textAlign: "center", boxShadow: "var(--shadow)" };
const statNum: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 17, color: "var(--accent-fg)" };
const statLbl: CSSProperties = { fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 };
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, display: "block" };
const input: CSSProperties = { width: "100%", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, outline: "none" };

export default function Login({
  onLogin, onGoogle, onSignup, configured, lang, langOpen, onToggleLang, onPickLang,
}: {
  // Phase 5a: real auth. Returns {ok,error}; on ok the parent navigates once the
  // session resolves. Async so the button can show a busy state.
  onLogin: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  // Google OAuth. Returns {ok,error}; on ok the browser redirects to Google (the
  // sign-in completes on return). Optional so any caller not wiring it just omits
  // the button (backward-compatible prop).
  onGoogle?: () => Promise<{ ok: boolean; error?: string }>;
  onSignup: () => void;
  configured: boolean;
  lang: string;
  langOpen: boolean;
  onToggleLang: () => void;
  onPickLang: (code: string) => void;
}) {
  const t = useT();
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  const [forgotOpen, setForgotOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [gbusy, setGbusy] = useState(false); // Google redirect in flight
  const [err, setErr] = useState("");

  const submit = async () => {
    if (busy) return;
    setErr("");
    if (!email.trim() || !password) { setErr(t.rd_login_err_empty); return; }
    setBusy(true);
    const res = await onLogin(email, password);
    if (!res.ok) { setErr(res.error || t.rd_login_err_failed); setBusy(false); }
    // on success the parent flips the screen; leave busy=true to avoid a flash.
  };
  const onGoogleClick = async () => {
    if (!onGoogle || gbusy || busy) return;
    setErr("");
    setGbusy(true);
    const res = await onGoogle();
    // On ok the browser redirects to Google — leave gbusy=true to avoid a flash.
    if (!res.ok) { setErr(res.error || t.rd_login_err_failed); setGbusy(false); }
  };

  // Real <form> submit — the single submit path (button type="submit" OR Enter in a
  // field both fire this natively). Wrapping the credential inputs in a <form> that
  // submits is what lets mobile password managers (iOS Keychain / Google Password
  // Manager) recognize a login and offer to SAVE it. preventDefault keeps it an SPA.
  const onFormSubmit = (e: React.FormEvent) => { e.preventDefault(); void submit(); };
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* hero band */}
      <div className="sfl-anim-sheen" style={{ background: "var(--header-bg)", padding: "34px 24px 30px", color: "var(--on-header)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,.12)", top: -50, right: -30 }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 11 }}>
          <img src="/redesign/icon-180.png" alt="SellerFlowLive" className="sfl-anim-float" style={{ width: 48, height: 48, borderRadius: 13, objectFit: "cover", boxShadow: "0 6px 16px rgba(0,0,0,.18)" }} />
          <div className="sfl-anim-beat" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 21, letterSpacing: "-.02em" }}>SellerFlowLive</div>
        </div>
        <div style={{ position: "relative", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 25, lineHeight: 1.2, marginTop: 22, letterSpacing: "-.02em" }}>{t.rd_login_hero_title}</div>
        <div style={{ position: "relative", fontSize: 13.5, opacity: 0.92, marginTop: 10, lineHeight: 1.5 }}>{t.rd_login_hero_sub}</div>
      </div>

      <div style={{ flex: 1, padding: "22px 22px 26px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <div style={card}><div style={statNum}>12k+</div><div style={statLbl}>{t.rd_login_stat_sellers}</div></div>
          <div style={card}><div style={statNum}>2.4M</div><div style={statLbl}>{t.rd_login_stat_orders}</div></div>
          <div style={card}><div style={statNum}>4.9★</div><div style={statLbl}>{t.rd_login_stat_rating}</div></div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)", marginBottom: 14 }}>{t.rd_login_welcome}</div>

        {onGoogle && (
          <>
            {/* Continue with Google — prominent (above the form), neutral surface (accent
                stays on the primary Log in button). Official 4-color Google G, unaltered. */}
            <button type="button" onClick={() => void onGoogleClick()} disabled={!configured || gbusy || busy}
              style={{ width: "100%", padding: "13px 14px", borderRadius: 13, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: (!configured || gbusy || busy) ? "default" : "pointer", opacity: (!configured || gbusy || busy) ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 11 }}>
              {/* Official Google "G" — 4 brand colors, viewBox 48×48 (square aspect kept). */}
              <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span>{t.rd_login_google}</span>
            </button>

            {/* "or" divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{t.rd_login_or}</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
          </>
        )}

        {/* Real <form> so password managers offer to save. display:contents keeps the
            exact flex-column layout (the form generates no box of its own). */}
        <form onSubmit={onFormSubmit} style={{ display: "contents" }}>
          <label style={label}>{t.rd_login_phone_email}</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} name="username" autoComplete="username" inputMode="email" placeholder={t.rd_login_email_ph} style={{ ...input, fontWeight: 600, marginBottom: 14 }} />

          <label style={label}>{t.rd_login_password}</label>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} name="password" autoComplete="current-password" placeholder={t.rd_login_password_ph} style={input} wrapStyle={{ marginBottom: 8 }} />

          <div style={{ textAlign: "right", marginBottom: 16 }}><span onClick={() => setForgotOpen(true)} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>{t.rd_login_forgot}</span></div>

          {err && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "var(--danger-soft, rgba(225,29,72,.1))", border: "1px solid var(--danger)", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>{err}</div>}
          {!configured && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{t.rd_login_unavailable}</div>}

          <button type="submit" disabled={busy} className={busy ? undefined : "sfl-anim-glow"} style={{ width: "100%", padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 6px 18px var(--accent-soft)" }}>{busy ? t.rd_login_logging_in : t.rd_login_login_btn}</button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5, color: "var(--text-dim)" }}>{t.rd_login_new_here} <span onClick={onSignup} style={{ fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>{t.rd_login_create_account}</span></div>

        <div style={{ marginTop: "auto", paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "none" }}>
              <span className="sfl-anim-wiggle" style={{ width: 24, height: 24, borderRadius: 7, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
              </span>
              <span className="sfl-anim-textglow" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)" }}>{t.rd_login_need_help}</span>
            </a>

            <div style={{ position: "relative" }}>
              {langOpen && (
                <div style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, width: 196, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 14px 34px rgba(0,0,0,.22)", padding: 6, zIndex: 20 }}>
                  {LANGS.map((l) => (
                    <button key={l.code} onClick={() => onPickLang(l.code)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "none", borderRadius: 9, background: l.code === lang ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ fontSize: 17, lineHeight: 1 }}>{l.flag}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{l.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={onToggleLang} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "7px 10px", cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="var(--text-dim)" strokeWidth="1.7" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="var(--text-dim)" strokeWidth="1.4" /></svg>
                <span style={{ fontSize: 15, lineHeight: 1 }}>{cur.flag}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>▾</span>
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 14 }}>{t.rd_login_terms_pre}<span style={{ color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>{t.rd_terms}</span></div>
        </div>
      </div>

      {/* Forgot-password modal (dc.html v3 L355–375) — admin-only reset → Telegram. */}
      {forgotOpen && (
        <div onClick={() => setForgotOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 320, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden" }}>
            <div style={{ padding: "22px 20px 18px", textAlign: "center" }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 8px 20px rgba(0,136,204,.4)" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{t.rd_login_reset_title}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, marginTop: 9 }}>{t.rd_login_reset_desc}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 9 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{TELEGRAM_HANDLE}</span>
              </div>
            </div>
            <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setForgotOpen(false)} style={{ flex: 1, padding: "15px 0", border: "none", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_login_maybe_next}</button>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" onClick={() => setForgotOpen(false)} style={{ flex: 1, padding: "15px 0", background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{t.rd_login_next}<span style={{ fontSize: 15 }}>→</span></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
