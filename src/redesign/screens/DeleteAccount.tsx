// Screen 16 — Delete Account. REAL flow, matching App.tsx DeleteAccountPage (1168)
// + handleDeleteAccount (4208): gate on typing your email → deleteUser (RLS deletes
// the seller_profiles row) → signOut → cleared. The auth listener then returns to
// login. (Same as production: the Supabase Auth user itself is not removed here —
// that needs the server service_role step — order/audit records may be kept.)
import { useState } from "react";
import { card } from "../ui";
import { useT } from "../i18n";

export default function DeleteAccount({ onBack, email = "", onConfirm }: {
  onBack: () => void;
  email?: string;
  onConfirm?: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canDelete = !!email && confirm.trim().toLowerCase() === email.toLowerCase();

  const submit = async () => {
    if (!canDelete || busy || !onConfirm) return;
    setBusy(true); setErr("");
    const r = await onConfirm();
    if (!r.ok) { setErr(r.error || t.rd_del_fail); setBusy(false); }
    // on success the auth listener flips to anon → routes to login (leave busy).
  };

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,.18)", border: "none", width: 32, height: 32, borderRadius: 9, color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_del_title}</div>
      </div>
      <div style={{ padding: "18px 16px 24px" }}>
        <div style={{ background: "var(--danger-soft, rgba(225,29,72,.08))", border: "1px solid var(--danger)", borderRadius: 16, padding: 18, textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(225,29,72,.14)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8v5" stroke="var(--danger)" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.5" r="1.3" fill="var(--danger)" /><path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="var(--danger)" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>{t.rd_del_heading}</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.55 }}>{t.rd_del_desc_pre}<b style={{ color: "var(--text)" }}>{email || t.rd_del_your_account}</b>{t.rd_del_desc_post}</div>
        </div>

        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55 }}>{t.rd_del_records}</div>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: "16px 2px 6px", display: "block" }}>{t.rd_del_type_email}</label>
        <input value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(""); }} placeholder={email} style={{ width: "100%", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" }} />
        {err && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", marginTop: 10 }}>{t.rd_del_warning_pre}{err}</div>}
        <button onClick={() => void submit()} disabled={!canDelete || busy} style={{ width: "100%", marginTop: 14, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--danger)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: canDelete && !busy ? "pointer" : "not-allowed", opacity: canDelete && !busy ? 1 : 0.5 }}>{busy ? t.rd_del_deleting : t.rd_del_confirm_btn}</button>
        <button onClick={onBack} style={{ width: "100%", marginTop: 10, padding: "13px 0", border: "1px solid var(--border-strong)", borderRadius: 13, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_del_keep}</button>
      </div>
    </div>
  );
}
