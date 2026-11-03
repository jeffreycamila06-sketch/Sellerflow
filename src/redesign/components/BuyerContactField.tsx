// Buyer contact picker (owner-approved UI, docs/plans/buyer-contact.md): "Buyer contact" label +
// ONE row of small round platform icons on the same line (selected = ring, others dimmed;
// 34 px, 32 px at ≤390 px — never wraps), one input below with the platform tag inside and a
// per-platform placeholder / hint, and the "Buyer has no contact" checkbox. Shared by Parcel
// Scan (7-11 + 全家) and both Customer Details screens. Scan QR lives in the screen header.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../i18n";
import { BUYER_CONTACT_PLATFORMS, contactError, lineHint, CONTACT_MAX_LEN, type BuyerContactPlatform } from "../adapters/buyerContact";

// Brand marks (small, single-colour). LINE + Facebook paths are the ContactChip ones.
const MARK: Record<BuyerContactPlatform, ReactNode> = {
  tiktok: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 5.8c-.9-1-1.4-2.3-1.4-3.6h-3.2v13.3c0 1.6-1.3 2.8-2.8 2.8s-2.8-1.3-2.8-2.8 1.3-2.8 2.8-2.8c.3 0 .6 0 .9.1V9.5c-.3 0-.6-.1-.9-.1-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6V9c1.3.9 2.9 1.5 4.6 1.5V7.3c-1.3 0-2.5-.6-3.2-1.5z" /></svg>,
  line: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2C6.5 3.2 2 6.9 2 11.4c0 4 3.5 7.4 8.3 8.1.3.1.7.2.8.5.1.3.1.7 0 1l-.1.7c0 .2.1.4.4.4.4 0 6.4-3.8 8.7-6.5 1.6-1.7 1.9-3.3 1.9-4.2 0-4.5-4.5-8.2-10-8.2zM8.5 13.6H6.4c-.3 0-.5-.2-.5-.5V9.4c0-.3.2-.5.5-.5s.5.2.5.5v3.2h1.6c.3 0 .5.2.5.5s-.2.5-.5.5zm1.9-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.4c0-.3.2-.5.5-.5s.5.2.5.5v3.7zm4.6 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-1.9-2.6v2.3c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.4c0-.2.1-.4.3-.5h.2c.2 0 .3.1.4.2l1.9 2.6V9.4c0-.3.2-.5.5-.5s.5.2.5.5v3.7zm3.1-2.4c.3 0 .5.2.5.5s-.2.5-.5.5h-1.6v1h1.6c.3 0 .5.2.5.5s-.2.5-.5.5H16c-.3 0-.5-.2-.5-.5V9.4c0-.3.2-.5.5-.5h2.1c.3 0 .5.2.5.5s-.2.5-.5.5h-1.6v1h1.6z" /></svg>,
  whatsapp: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.2 21.8l4.9-1.3A9.8 9.8 0 1 0 12 2.2zm0 17.9c-1.5 0-3-.4-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.1 8.1 0 1 1 12 20.1zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.7-.3-1.5-.7-2.2-1.4-.6-.5-1.1-1.3-1.3-1.6-.1-.2 0-.4.1-.5l.4-.5.3-.4c.1-.2 0-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.6 1.1 2.7c.1.2 1.8 2.8 4.5 3.9 1.6.6 2.2.7 2.9.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.2-.2-.3-.5-.4z" /></svg>,
  facebook: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8.5V6.8c0-.7.4-1.1 1.1-1.1H17V3h-2.9c-2.2 0-3.6 1.4-3.6 3.7v1.8H8v3h2.5V21h3.4v-9.5h2.4l.3-3H14z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>,
  other: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="12" r="2" /></svg>,
};
const BRAND: Record<BuyerContactPlatform, { bg: string; fg: string }> = {
  tiktok: { bg: "#111111", fg: "#ffffff" },
  line: { bg: "#06C755", fg: "#ffffff" },
  whatsapp: { bg: "#25D366", fg: "#ffffff" },
  facebook: { bg: "#1877F2", fg: "#ffffff" },
  instagram: { bg: "#E1306C", fg: "#ffffff" },
  other: { bg: "var(--surface-2)", fg: "var(--text-dim)" },
};
const TAG: Record<BuyerContactPlatform, string> = { tiktok: "TikTok", line: "LINE", whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram", other: "…" };
const INPUT_MODE: Partial<Record<BuyerContactPlatform, "tel">> = { whatsapp: "tel" };

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, outline: "none" };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const hintTxt: CSSProperties = { fontSize: 11, color: "var(--text-dim)", marginTop: 3 };

export interface BuyerContactFieldProps {
  platform: BuyerContactPlatform;
  onPlatform: (p: BuyerContactPlatform) => void;
  value: string;
  onValue: (v: string) => void;
  noContact: boolean;
  onNoContact: (on: boolean) => void;
  invalid?: boolean;        // the screen's "contact missing" error (shown as the handle error)
  testId?: string;          // prefix for data-testids (default "bc")
  inputId?: string;
}

export default function BuyerContactField({ platform, onPlatform, value, onValue, noContact, onNoContact, invalid = false, testId = "bc", inputId }: BuyerContactFieldProps) {
  const t = useT();
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth <= 390);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setNarrow(window.innerWidth <= 390);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const size = narrow ? 32 : 34;
  const err = contactError(platform, value);
  const ph: Record<BuyerContactPlatform, string> = {
    tiktok: t.rd_bc_ph_tiktok, line: t.rd_bc_ph_line, whatsapp: t.rd_bc_ph_whatsapp, facebook: t.rd_bc_ph_facebook, instagram: t.rd_bc_ph_instagram, other: t.rd_bc_ph_other,
  };
  const names: Record<BuyerContactPlatform, string> = {
    tiktok: t.rd_bc_name_tiktok, line: t.rd_bc_name_line, whatsapp: t.rd_bc_name_whatsapp, facebook: t.rd_bc_name_facebook, instagram: t.rd_bc_name_instagram, other: t.rd_bc_name_other,
  };
  const hint = platform === "line" ? (lineHint(value) ? t.rd_bc_hint_line : "") : platform === "whatsapp" ? t.rd_bc_hint_whatsapp : ""; // LINE: only when digits were typed
  return (
    <div data-testid={`${testId}-field`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, minWidth: 0 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }} htmlFor={inputId}>{t.rd_bc_label}</label>
        <div role="radiogroup" aria-label={t.rd_bc_label} style={{ display: "flex", gap: narrow ? 4 : 6, flexShrink: 0 }} data-testid={`${testId}-platforms`}>
          {BUYER_CONTACT_PLATFORMS.map((p) => {
            const on = p === platform;
            const b = BRAND[p];
            return (
              <button
                key={p} type="button" role="radio" aria-checked={on} aria-label={names[p]} title={names[p]}
                onClick={() => onPlatform(p)} data-testid={`${testId}-pick-${p}`} data-selected={on ? "1" : "0"}
                style={{
                  width: size, height: size, borderRadius: "50%", padding: 0, border: p === "other" ? "1px solid var(--border-strong)" : "none",
                  background: b.bg, color: b.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  opacity: on ? 1 : 0.42, transform: on ? "scale(1.06)" : "none",
                  boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : "none", transition: "opacity .12s, transform .12s, box-shadow .12s",
                }}
              >
                <span style={{ width: Math.round(size * 0.53), height: Math.round(size * 0.53), display: "inline-flex" }}>{MARK[p]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <span data-testid={`${testId}-tag`} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 7, background: BRAND[platform].bg, color: BRAND[platform].fg, border: platform === "other" ? "1px solid var(--border-strong)" : "none", pointerEvents: "none", letterSpacing: ".01em" }}>{TAG[platform]}</span>
        <input
          id={inputId}
          value={value}
          onChange={(e) => { const v = e.target.value.slice(0, CONTACT_MAX_LEN); onValue(v); if (v.trim() !== "" && noContact) onNoContact(false); }}
          maxLength={CONTACT_MAX_LEN}
          inputMode={INPUT_MODE[platform]}
          placeholder={ph[platform]}
          style={{ ...input, paddingLeft: platform === "other" ? 42 : platform === "tiktok" ? 72 : platform === "line" ? 60 : 92, ...(noContact ? { opacity: 0.5 } : {}) }}
          data-testid={`${testId}-input`}
          data-platform={platform}
          aria-invalid={invalid || err !== ""}
          aria-label={t.rd_bc_label}
        />
      </div>
      {err === "whatsapp" && !noContact && <div style={errTxt} data-testid={`${testId}-err`}>{t.rd_bc_err_whatsapp}</div>}
      {hint && err === "" && <div style={hintTxt}>{hint}</div>}
      {invalid && !noContact && err === "" && <div style={errTxt} data-testid={`${testId}-missing`}>{t.rd_ps2_err_handle}</div>}
      <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, cursor: "pointer", fontSize: 12, color: "var(--text-dim)" }}>
        <input type="checkbox" checked={noContact} onChange={(e) => { const on = e.target.checked; onNoContact(on); if (on) onValue(""); }} data-testid={`${testId}-none`} />
        {t.rd_bc_no_contact}
      </label>
    </div>
  );
}
