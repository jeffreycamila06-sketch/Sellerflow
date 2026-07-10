// "Invite friends" — a small share-the-app card pinned to the TOP of the Settings
// hub grid (full-width, lightly tinted so it's noticed first). Native share sheet
// (navigator.share, works in iOS/Android WebView + mobile browsers) with a
// copy-to-clipboard + inline "copied" fallback for desktop. NO referral codes,
// NO rewards, NO network calls. Copy is deliberately payment-free (iOS 3.1.1-safe)
// — pure "invite a friend to try the app", so no isIOS() gating is needed.
import { useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import { INVITE_URL, copyText } from "./inviteShare";

const megaphone = (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M4 9v6h3l7 4V5L7 9H4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M17 9a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export default function InviteFriendsCard() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const message = t.rd_inv_share;
  const full = `${message} ${INVITE_URL}`;

  const onShare = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message, url: INVITE_URL });
        return; // native sheet handled it — no inline confirmation needed
      } catch (e) {
        if ((e as { name?: string } | null)?.name === "AbortError") return; // user dismissed
        // any other error → fall through to the copy fallback
      }
    }
    const ok = await copyText(full);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  // Same form as the other hub tiles (radius/padding/shadow); only the tint
  // differs, and it spans both grid columns so it's the first thing seen.
  const cardStyle: CSSProperties = {
    gridColumn: "1 / -1",
    display: "flex", alignItems: "center", gap: 12,
    padding: "15px 14px",
    border: "1px solid var(--accent-soft)",
    borderRadius: 15,
    background: "var(--accent-soft)",
    boxShadow: "var(--shadow)",
    cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)",
  };

  return (
    <button onClick={onShare} style={cardStyle}>
      <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{megaphone}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t.rd_inv_title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--text-dim)", marginTop: 1 }}>{t.rd_inv_desc}</span>
      </span>
      {copied ? (
        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: "#fff", background: "var(--accent)", borderRadius: 999, padding: "5px 11px" }}>{t.rd_inv_copied}</span>
      ) : (
        <span style={{ fontSize: 16, color: "var(--accent-fg)", flexShrink: 0 }}>›</span>
      )}
    </button>
  );
}
