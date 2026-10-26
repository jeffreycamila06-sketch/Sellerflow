// SHOPEE LIVE BETA — the paste-link panel (the Shopee tile's panel and the "Change link"
// dropdown). Paste the live's share link → Connect. `error` = an i18n key from the last
// connect (RedesignApp owns it; the server decides). No Disconnect: the reader stops by
// itself when the live ends (same rule as Facebook).
import { useState } from "react";
import { useT } from "../i18n";

export interface ShopeeLinkProps {
  daysLeft: number | null;              // beta days left (tile subtitle); null for admins
  error: string | null;                 // i18n key of the last connect failure
  onConnect: (shareLink: string) => void;
  connecting?: boolean;
}

export default function ShopeeLinkForm({ error, onConnect, connecting = false }: ShopeeLinkProps) {
  const t = useT() as Record<string, string>;
  const [link, setLink] = useState("");
  const ready = !!link.trim() && !connecting;
  const go = () => { if (ready) onConnect(link.trim()); };
  return (
    <div data-testid="sh-link-form" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 8px 8px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)" }}>{t.rd_sh_paste_label}</div>
      <input
        data-testid="sh-link-input" value={link} onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
        placeholder={t.rd_sh_placeholder} inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 9, border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`, background: "var(--surface)", color: "var(--text)", fontSize: 16 }}
      />
      {error && <div data-testid="sh-link-error" role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", background: "var(--danger-soft)", padding: "7px 9px", borderRadius: 8 }}>{t[error] ?? error}</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_sh_link_help}</div>
      <button
        data-testid="sh-link-connect" type="button" onClick={go} disabled={!ready}
        style={{ width: "100%", minHeight: 44, border: "none", borderRadius: 10, background: "#ee4d2d", color: "#fff", fontWeight: 800, fontSize: 14, opacity: ready ? 1 : 0.6 }}
      >{connecting ? t.rd_dash_connecting : t.rd_shp_connect}</button>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.rd_sh_own_only}</div>
    </div>
  );
}
