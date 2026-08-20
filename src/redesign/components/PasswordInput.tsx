// Password field with a show/hide (eye) toggle. Reused by Login + Signup so the 3
// password inputs share one accessible, design-token-consistent implementation.
// Default = masked (type="password"); tap the eye to reveal, tap again to hide.
import { useState, type CSSProperties } from "react";
import { useT } from "../i18n";

export default function PasswordInput({
  value, onChange, onKeyDown, placeholder, autoComplete, name, style, wrapStyle,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  // Forwarded to the inner <input> so password managers can pair it with the
  // username field (they key off name + autoComplete). Optional/additive.
  name?: string;
  style?: CSSProperties;       // applied to the <input> (no layout margins — use wrapStyle)
  wrapStyle?: CSSProperties;   // layout margins go here so the eye stays vertically centered
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", ...wrapStyle }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        name={name}
        style={{ ...style, paddingRight: 44 }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t.rd_pw_hide : t.rd_pw_show}
        aria-pressed={show}
        style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 42, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-muted)" }}
      >
        {show ? (
          // eye-off
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.12 6.12A18.42 18.42 0 0 0 1 12s4 8 11 8a10.94 10.94 0 0 0 5.88-1.72" /><path d="M3 3l18 18" /></svg>
        ) : (
          // eye
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </div>
  );
}
