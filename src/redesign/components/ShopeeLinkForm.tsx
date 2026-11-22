// SHOPEE LIVE BETA — the paste-link panel (the Shopee tile's panel and the "Change link"
// dropdown). Paste the live's share link → Connect. `error` = an i18n key from the last
// connect (RedesignApp owns it; the server decides). No Disconnect: the reader stops by
// itself when the live ends (same rule as Facebook).
//
// Button (2026-11-22, Jeff's approved design): "Connecting…" and not tappable for the WHOLE
// connect (RedesignApp's `connecting` covers the session check too); "✓ Connected" (green
// outline) and not tappable while Shopee is green AND the box holds the link that was connected
// (`connectedLink`); editing the box to another link makes it "Connect" again.
// `initialLink` = what the box starts with (RedesignApp keeps the last link the seller tapped
// Connect with, so the box reopens with it after the picker hid it during the connect). When
// it changes while the box still shows the old one, the box follows it.
import { useState } from "react";
import { useT } from "../i18n";

export interface ShopeeLinkProps {
  daysLeft: number | null;              // beta days left (tile subtitle); null for admins
  error: string | null;                 // i18n key of the last connect failure
  onConnect: (shareLink: string) => void;
  connecting?: boolean;
  connected?: boolean;                  // the Shopee pill is green for this device
  connectedLink?: string;               // the link that connect was made with ("" = none)
  initialLink?: string;                 // the box's starting text ("" = empty)
  notice?: string | null;               // i18n key of the last stop the server explained (orange line)
}

export default function ShopeeLinkForm({ error, onConnect, connecting = false, connected = false, connectedLink = "", initialLink = "", notice = null }: ShopeeLinkProps) {
  const t = useT() as Record<string, string>;
  const [link, setLink] = useState(initialLink);
  const [prevInitial, setPrevInitial] = useState(initialLink);
  if (initialLink !== prevInitial) { // adjust-during-render: follow a new starting text only if the box was not edited
    setPrevInitial(initialLink);
    if (link.trim() === prevInitial.trim()) setLink(initialLink);
  }
  const showsConnected = !connecting && connected && !!connectedLink.trim() && link.trim() === connectedLink.trim();
  const ready = !!link.trim() && !connecting && !showsConnected;
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
      {notice && !connecting && !showsConnected && <div data-testid="sh-link-notice" role="status" className="sfl-sh-notice" style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 10px", borderRadius: 8, lineHeight: 1.35 }}>{t[notice] ?? notice}</div>}
      {error && <div data-testid="sh-link-error" role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", background: "var(--danger-soft)", padding: "7px 9px", borderRadius: 8 }}>{t[error] ?? error}</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_sh_link_help}</div>
      {showsConnected ? (
        <button
          data-testid="sh-link-connect" data-state="connected" type="button" disabled className="sfl-sh-connected"
          style={{ width: "100%", minHeight: 44, borderRadius: 10, fontWeight: 800, fontSize: 14 }}
        >{t.rd_sh_connected_btn}</button>
      ) : (
        <button
          data-testid="sh-link-connect" data-state={connecting ? "connecting" : "connect"} type="button" onClick={go} disabled={!ready}
          style={{ width: "100%", minHeight: 44, border: "none", borderRadius: 10, background: "#ee4d2d", color: "#fff", fontWeight: 800, fontSize: 14, opacity: ready ? 1 : 0.6 }}
        >{connecting ? t.rd_dash_connecting : t.rd_shp_connect}</button>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.rd_sh_own_only}</div>
    </div>
  );
}
