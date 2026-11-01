// TIKTOK API — Branch 1: Settings → "TikTok videos — sell from comments" (NOT the live "TikTok
// Connect"). States: not connected / connected / connect again (revoked) / personal account.
// Connect = a REAL anchor to the signed OAuth URL (iOS-safe); new app builds open the in-app
// sign-in sheet (the Facebook "Authorize auto-return" pattern) and the callback bounces back with
// ?tt=connected | ?tt=error&code=… which RedesignApp toasts. The card hides when the server says
// "off" (kill switch). Design: docs/design/tiktok-api (screens 01–04).
import { useEffect, useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import { startTtAuth, ttDisconnect, useTtAccount, initialsOf, followersText, type TtAccount } from "../adapters/tiktokApi";
import { nativeAuthSession } from "../adapters/fb";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px", boxShadow: "var(--shadow)", marginBottom: 12 };
const primary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none", cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" };
const secondary: CSSProperties = { ...primary, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border-strong)", boxShadow: "none" };


export default function TikTokVideos({ onBack, onToast, lastReturnCode = "", enabled = true }: {
  onBack: () => void;
  onToast?: (msg: string, kind: "ok" | "err") => void;
  lastReturnCode?: string; // "not_business" after a refused connect → the personal-account state
  enabled?: boolean;
}) {
  const t = useT();
  const { status, reload } = useTtAccount(enabled);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);
  const [authSession] = useState(() => nativeAuthSession());
  const [busy, setBusy] = useState(false);
  const account: TtAccount | null = status?.kind === "ok" ? status.account : null;
  const wantsLink = enabled && status?.kind === "ok" && (!account || account.status !== "active");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let alive = true;
    if (!wantsLink) { setAuthUrl(null); return; }
    void startTtAuth(authSession ? { app: true } : {}).then((r) => { if (alive) setAuthUrl(r.ok && r.url ? r.url : null); });
    return () => { alive = false; };
  }, [wantsLink, authTick, authSession]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Back in the app (visible / focused) → re-read the account + a fresh link.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = 0;
    const back = () => { if (document.visibilityState === "hidden") return; const now = Date.now(); if (now - last < 1000) return; last = now; void reload(); setAuthTick((n) => n + 1); };
    document.addEventListener("visibilitychange", back); window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [reload]);

  const connectInApp = async () => {
    if (!authSession || !authUrl || busy) return;
    setBusy(true);
    let r: { status: string; code?: string };
    try { r = await authSession({ url: authUrl }); } catch { r = { status: "error" }; }
    setBusy(false); setAuthTick((n) => n + 1); void reload();
    if (r.status === "connected") onToast?.(t.rd_tt_connected_toast, "ok");
    else if (r.status === "error") onToast?.(r.code === "not_business" ? t.rd_tt_not_business_toast : r.code === "not_registered" ? t.rd_tt_not_registered_toast : t.rd_tt_connect_failed, "err");
  };
  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    const r = await ttDisconnect();
    setBusy(false);
    onToast?.(r.ok ? t.rd_tt_disconnected_toast : t.rd_tt_disconnect_failed, r.ok ? "ok" : "err");
    void reload();
  };
  const connectControl = (label: string, style: CSSProperties = primary) => (
    authSession ? <button type="button" data-testid="tt-connect" onClick={() => void connectInApp()} disabled={!authUrl || busy} style={{ ...style, opacity: !authUrl || busy ? 0.6 : 1 }}>{label}</button>
    : authUrl ? <a data-testid="tt-connect" href={authUrl} target="_blank" rel="noreferrer noopener" style={style}>{label}</a>
    : <span data-testid="tt-connect" style={{ ...style, opacity: 0.6 }}>{label}</span>
  );

  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span aria-hidden style={{ width: 34, height: 34, borderRadius: 9, background: "var(--text)", color: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, flexShrink: 0 }}>♪</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{t.rd_tt_card_title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_tt_card_sub}</div>
      </div>
    </div>
  );

  let body: JSX.Element;
  if (!status) body = <div data-testid="tt-state-loading" style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.rd_loading}</div>;
  else if (status.kind === "off") body = <div data-testid="tt-state-off" style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.rd_tt_off}</div>;
  else if (status.kind === "error") body = <div data-testid="tt-state-error" style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.rd_tt_read_failed} <button type="button" onClick={() => void reload()} style={{ border: "none", background: "none", color: "var(--accent)", fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_tt_retry}</button></div>;
  else if (!account && lastReturnCode === "not_business") body = (
    <div data-testid="tt-state-not-business">
      <div style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 12, padding: "12px 13px", marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--warn)", marginBottom: 4 }}>{t.rd_tt_personal_title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{t.rd_tt_personal_body}</div>
      </div>
      {connectControl(t.rd_tt_connect_again, secondary)}
    </div>
  );
  else if (!account) body = (
    <div data-testid="tt-state-none">
      {connectControl(t.rd_tt_connect)}
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 8 }}>{t.rd_tt_connect_help}</div>
    </div>
  );
  else body = (
    <div data-testid={account.status === "active" ? "tt-state-connected" : "tt-state-reconnect"}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px" }}>
        {account.avatarUrl ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          : <span style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{initialsOf(account.displayName || account.username)}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{account.username}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{followersText(account.followers)} {t.rd_tt_followers} · {account.status === "active"
            ? <span style={{ color: "var(--ok)", fontWeight: 700 }}>● {t.rd_tt_connected}</span>
            : <span style={{ color: "var(--warn)", fontWeight: 800, border: "1px solid var(--warn)", borderRadius: 6, padding: "1px 6px" }}>{t.rd_tt_connect_again}</span>}</div>
        </div>
      </div>
      {account.status !== "active" && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--warn)", lineHeight: 1.5, margin: "10px 0" }}>{t.rd_tt_revoked_body}</div>}
      {account.status !== "active" && <div style={{ marginBottom: 8 }}>{connectControl(t.rd_tt_connect_again)}</div>}
      <button type="button" data-testid="tt-disconnect" onClick={() => void disconnect()} disabled={busy} style={{ ...secondary, color: "var(--danger)", marginTop: account.status === "active" ? 10 : 0, opacity: busy ? 0.6 : 1 }}>{t.rd_tt_disconnect}</button>
    </div>
  );

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>♪</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{t.rd_tt_screen_title}</div>
        </div>
      </div>
      <div style={{ padding: "16px 14px 24px" }}>
        <div style={card}>{head}{body}</div>
      </div>
    </div>
  );
}
