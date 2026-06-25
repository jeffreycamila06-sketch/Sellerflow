// Screen 5 — Login / Landing (pre-auth, no bottom nav). dc.html v3 L284–376.
// v3: a "Forgot password?" modal (admin-only reset → Telegram redirect).
import { useState, type CSSProperties } from "react";
import { LANGS } from "../data";

const card: CSSProperties = { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: 11, textAlign: "center", boxShadow: "var(--shadow)" };
const statNum: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 17, color: "var(--accent-fg)" };
const statLbl: CSSProperties = { fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 };
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, display: "block" };
const input: CSSProperties = { width: "100%", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, outline: "none" };

export default function Login({
  onLogin, onSignup, configured, lang, langOpen, onToggleLang, onPickLang,
}: {
  // Phase 5a: real auth. Returns {ok,error}; on ok the parent navigates once the
  // session resolves. Async so the button can show a busy state.
  onLogin: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onSignup: () => void;
  configured: boolean;
  lang: string;
  langOpen: boolean;
  onToggleLang: () => void;
  onPickLang: (code: string) => void;
}) {
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  const [forgotOpen, setForgotOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (busy) return;
    setErr("");
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    const res = await onLogin(email, password);
    if (!res.ok) { setErr(res.error || "Sign-in failed. Check your details and try again."); setBusy(false); }
    // on success the parent flips the screen; leave busy=true to avoid a flash.
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } };
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* hero band */}
      <div style={{ background: "var(--header-bg)", padding: "34px 24px 30px", color: "var(--on-header)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,.12)", top: -50, right: -30 }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 11 }}>
          <img src="/redesign/icon-180.png" alt="SellerFlowLive" style={{ width: 48, height: 48, borderRadius: 13, objectFit: "cover", boxShadow: "0 6px 16px rgba(0,0,0,.18)" }} />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 21, letterSpacing: "-.02em" }}>SellerFlowLive</div>
        </div>
        <div style={{ position: "relative", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 25, lineHeight: 1.2, marginTop: 22, letterSpacing: "-.02em" }}>Turn every live comment into a paid order.</div>
        <div style={{ position: "relative", fontSize: 13.5, opacity: 0.92, marginTop: 10, lineHeight: 1.5 }}>Auto-capture "mine" claims from TikTok &amp; Facebook live, build order slips instantly, and print to ship.</div>
      </div>

      <div style={{ flex: 1, padding: "22px 22px 26px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <div style={card}><div style={statNum}>12k+</div><div style={statLbl}>sellers</div></div>
          <div style={card}><div style={statNum}>2.4M</div><div style={statLbl}>orders</div></div>
          <div style={card}><div style={statNum}>4.9★</div><div style={statLbl}>rating</div></div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)", marginBottom: 14 }}>Welcome back</div>

        <label style={label}>Phone or email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} autoComplete="username" inputMode="email" placeholder="you@example.com" style={{ ...input, fontWeight: 600, marginBottom: 14 }} />

        <label style={label}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey} autoComplete="current-password" placeholder="Your password" style={{ ...input, marginBottom: 8 }} />

        <div style={{ textAlign: "right", marginBottom: 16 }}><span onClick={() => setForgotOpen(true)} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>Forgot password?</span></div>

        {err && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "var(--danger-soft, rgba(225,29,72,.1))", border: "1px solid var(--danger)", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>{err}</div>}
        {!configured && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Sign-in is unavailable in this preview (Supabase not configured).</div>}

        <button onClick={() => void submit()} disabled={busy} style={{ width: "100%", padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 6px 18px var(--accent-soft)" }}>{busy ? "Logging in…" : "Log in"}</button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5, color: "var(--text-dim)" }}>New here? <span onClick={onSignup} style={{ fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>Create account</span></div>

        <div style={{ marginTop: "auto", paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <button onClick={() => setForgotOpen(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <span style={{ width: 24, height: 24, borderRadius: 7, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)" }}>Need help?</span>
            </button>

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
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 14 }}>By continuing you agree to our <span style={{ color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Terms</span></div>
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
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>Reset your password</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, marginTop: 9 }}>For your security, passwords can only be reset by an admin. Message us on Telegram and we’ll help you create a new password right away.</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 9 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>@SellerFlowSupport</span>
              </div>
            </div>
            <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setForgotOpen(false)} style={{ flex: 1, padding: "15px 0", border: "none", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Maybe next time</button>
              <a href="https://t.me/SellerFlowSupport" target="_blank" rel="noreferrer" onClick={() => setForgotOpen(false)} style={{ flex: 1, padding: "15px 0", background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>Next<span style={{ fontSize: 15 }}>→</span></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
