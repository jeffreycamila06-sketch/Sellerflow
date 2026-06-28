// Screen 17 — Create account (signup). dc.html v3 L378–431.
// REAL self-serve registration — wired to the same path as production's PublicAuth
// `reg` (App.tsx:738-758) via auth.register: signUp → createMyProfile → the auth
// listener logs the user in (dashboard appears). No Telegram redirect, no Soon badge.
import { useState, type CSSProperties } from "react";
import type { RegisterFields, RegisterResult } from "../adapters/useAuthSession";
import { useT } from "../i18n";
import PasswordInput from "../components/PasswordInput";

const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "0 2px 9px" };
const groupCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 12 };

export default function Signup({ onBack, onLegal, onRegister }: {
  onBack: () => void;
  onLegal: () => void;
  // Real registration. On ok (with a session) the auth listener flips to the
  // dashboard; on needsConfirm we show a "check your email" message + back to login.
  onRegister: (f: RegisterFields) => Promise<RegisterResult>;
}) {
  const t = useT();
  const [form, setForm] = useState({ storeName: "", fullName: "", phone: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErr(""); };

  const submit = async () => {
    if (busy) return;
    setErr(""); setOk("");
    setBusy(true);
    const r = await onRegister({
      email: form.email, password: form.password, confirm: form.confirm,
      fullName: form.fullName, storeName: form.storeName, phone: form.phone,
    });
    if (r.ok && r.needsConfirm) { setOk(t.rd_su_ok_confirm); setBusy(false); return; }
    if (!r.ok) { setErr(r.error || t.rd_su_err); setBusy(false); return; }
    // success with a session: leave busy=true; the auth listener navigates to the dashboard.
  };

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "var(--header-bg)", padding: "16px 16px 18px", color: "var(--on-header)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_login_create_account}</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{t.rd_su_subtitle}</div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 22px" }}>
        <div style={groupLabel}>{t.rd_su_shop_profile}</div>
        <div style={groupCard}>
          <div><label style={label}>{t.rd_set_shop_name}</label><input value={form.storeName} onChange={(e) => set("storeName", e.target.value)} placeholder={t.rd_su_shop_ph} style={input} /></div>
          <div style={{ display: "flex", gap: 9 }}>
            <div style={{ flex: 1, minWidth: 0 }}><label style={label}>{t.rd_set_owner_name}</label><input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder={t.rd_su_fullname_ph} style={input} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><label style={label}>{t.rd_set_phone}</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder={t.rd_su_phone_ph} inputMode="tel" style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 13 }} /></div>
          </div>
          <div><label style={label}>{t.rd_set_email}</label><input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder={t.rd_su_email_ph} autoComplete="email" inputMode="email" style={input} /></div>
        </div>

        <div style={{ ...groupLabel, margin: "16px 2px 9px" }}>{t.rd_su_password_h}</div>
        <div style={groupCard}>
          <div><label style={label}>{t.rd_login_password}</label><PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={t.rd_su_pw_ph} autoComplete="new-password" style={input} /></div>
          <div><label style={label}>{t.rd_su_confirm}</label><PasswordInput value={form.confirm} onChange={(e) => set("confirm", e.target.value)} placeholder={t.rd_su_confirm_ph} autoComplete="new-password" style={input} /></div>
        </div>

        {err && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "var(--danger-soft, rgba(225,29,72,.1))", border: "1px solid var(--danger)", borderRadius: 10, padding: "9px 12px", marginTop: 14 }}>{err}</div>}
        {ok && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)", background: "rgba(16,185,129,.1)", border: "1px solid var(--ok)", borderRadius: 10, padding: "9px 12px", marginTop: 14 }}>{ok}</div>}

        <button onClick={() => void submit()} disabled={busy} style={{ width: "100%", marginTop: 18, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 6px 18px var(--accent-soft)" }}>{busy ? t.rd_su_creating : t.rd_login_create_account}</button>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 11, lineHeight: 1.5 }}>{t.rd_su_terms_pre}<span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 700, cursor: "pointer" }}>{t.rd_terms}</span></div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_su_have_account} <span onClick={onBack} style={{ fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>{t.rd_login_login_btn}</span></div>
      </div>
    </div>
  );
}
