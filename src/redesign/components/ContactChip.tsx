// Admin contact chip — parity with App.tsx ContactDisplay + ContactEditor (328-430).
// Stored as a single seller_profiles.admin_contact_note text column with the
// "<platform>:<name>" convention (platform ∈ fb/telegram/line). Renders a colored
// pill with the platform icon; click → inline edit (platform toggle + name input).
// Legacy / unprefixed notes are preserved and shown as plain text; empty → an
// "add contact…" placeholder (only when editable). Brand colors are literal
// (Facebook/Telegram/Line); neutral surfaces use design tokens. Admin-only.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../i18n";

export const CONTACT_PLATFORMS = ["fb", "telegram", "line"] as const;
export type ContactPlatform = (typeof CONTACT_PLATFORMS)[number];

const THEME: Record<ContactPlatform, { label: string; fg: string; bg: string }> = {
  fb: { label: "Facebook", fg: "#0C447C", bg: "#E6F1FB" },
  telegram: { label: "Telegram", fg: "#0F6E56", bg: "#E1F5EE" },
  line: { label: "Line", fg: "#854F0B", bg: "#FAEEDA" },
};

const ICONS: Record<ContactPlatform, ReactNode> = {
  fb: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8.5V6.8c0-.7.4-1.1 1.1-1.1H17V3h-2.9c-2.2 0-3.6 1.4-3.6 3.7v1.8H8v3h2.5V21h3.4v-9.5h2.4l.3-3H14z" /></svg>,
  telegram: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 3L2 11.4l5.8 2 9.2-6.4-7.3 8.6 1.7 5.6 3-3.1 4.6 3.4L22 3z" /></svg>,
  line: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2C6.5 3.2 2 6.9 2 11.4c0 4 3.5 7.4 8.3 8.1.3.1.7.2.8.5.1.3.1.7 0 1l-.1.7c0 .2.1.4.4.4.4 0 6.4-3.8 8.7-6.5 1.6-1.9 2.1-3.8 2.1-5.4 0-4.5-4.5-8.2-10-8.2zM8 13.5H6V8.7h.9v4H8v.8zm1.9 0h-.9V8.7h.9v4.8zm5.5 0h-.9l-2-3v3h-.9V8.7h.9l2 3v-3h.9v4.8zm3.3-3.7H17v.9h1.6v.8H17v1h1.6v.8h-2.4V8.7h2.4v.9z" /></svg>,
};

// PURE — "<platform>:<name>" → structured; unknown/absent prefix = legacy plain text
// (preserved as-is so no existing note is lost). Verbatim logic from App.tsx:345.
export function parseContact(raw: string): { platform: ContactPlatform | ""; name: string; legacy: boolean } {
  if (!raw) return { platform: "", name: "", legacy: false };
  const i = raw.indexOf(":");
  if (i > 0) {
    const prefix = raw.slice(0, i).trim().toLowerCase();
    if ((CONTACT_PLATFORMS as readonly string[]).includes(prefix)) {
      return { platform: prefix as ContactPlatform, name: raw.slice(i + 1).trim(), legacy: false };
    }
  }
  return { platform: "", name: raw.trim(), legacy: true };
}

// PURE — compose "<platform>:<name>" (plain name when no platform; "" when empty).
// Verbatim from App.tsx:357.
export function formatContact(platform: ContactPlatform | "", name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return platform ? `${platform}:${trimmed}` : trimmed;
}

const pill = (fg: string, bg: string, clickable: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10,
  color: fg, background: bg, fontSize: 11, fontWeight: 600, lineHeight: "16px", cursor: clickable ? "pointer" : "default",
});

export default function ContactChip({ note, onSave }: { note: string; onSave?: (note: string) => void }) {
  const t = useT();
  const [local, setLocal] = useState(note);
  useEffect(() => setLocal(note), [note]); // sync external updates (refetch after save)
  const [editing, setEditing] = useState(false);
  const [platform, setPlatform] = useState<ContactPlatform | "">("");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editable = !!onSave;

  const open = () => {
    if (!editable) return;
    const p = parseContact(local);
    setPlatform(p.platform); setName(p.name); setEditing(true);
  };
  const save = () => {
    const next = formatContact(platform, name);
    setLocal(next); setEditing(false);
    onSave?.(next); // parent persists (adminUpdateContactNote) + refetches
  };
  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; save(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
        style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 150 }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {CONTACT_PLATFORMS.map((p) => {
            const th = THEME[p]; const on = platform === p;
            return (
              <button key={p} type="button" title={th.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); setPlatform(on ? "" : p); inputRef.current?.focus(); }}
                style={{ width: 26, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: on ? `2px solid ${th.fg}` : "1px solid var(--border-strong)", borderRadius: 7, background: on ? th.bg : "var(--surface)", color: th.fg, cursor: "pointer", lineHeight: 0 }}
              >{ICONS[p]}</button>
            );
          })}
        </div>
        <input ref={inputRef} autoFocus value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)} placeholder={t.rd_adm_contact_name_ph}
          style={{ padding: "5px 8px", border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface)", color: "var(--text)", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-ui)", outline: "none" }} />
      </div>
    );
  }

  const p = parseContact(local);
  if (!local) {
    return <span onClick={open} style={{ fontSize: 11, color: "var(--text-muted)", cursor: editable ? "pointer" : "default", fontStyle: "italic" }}>{editable ? t.rd_adm_add_contact : ""}</span>;
  }
  if (p.platform) {
    const th = THEME[p.platform];
    return <span onClick={open} style={pill(th.fg, th.bg, editable)}>{ICONS[p.platform]}<span>{p.name || th.label}</span></span>;
  }
  return <span onClick={open} style={{ color: "var(--text-dim)", fontSize: 11, cursor: editable ? "pointer" : "default" }}>{p.name}</span>;
}
