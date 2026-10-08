// INSTAGRAM LIVE — phase 1. Manage Instagram accounts (reached from Settings' channels screen
// and the Live picker's Instagram menu, only while igEnabled). Lists the seller's authorized
// Instagram accounts, "Authorize Instagram" (a REAL <a> to the pre-fetched OAuth URL — iOS-safe —
// or the in-app sign-in sheet on new app builds) and a per-account Remove. Mirror of FbChannels.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { maxAcc } from "../adapters/connect";
import { isFbEligible, nativeAuthSession } from "../adapters/fb";
import { startIgAuth, removeIgAccount, igDisconnect, igReturnText, type IgAccount } from "../adapters/ig";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
import AccountQuotaLine from "../components/AccountQuotaLine";
import { useAccountCoverage, isCovered, notCoveredLabel } from "../adapters/accountLive";
import { isIOS } from "../adapters/platform";

export const IG_AUTH_REFRESH_MS = 8 * 60 * 1000; // the signed state lasts 10 minutes
const IG_BRAND = "#c13584";
const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px", marginBottom: 12, boxShadow: "var(--shadow)" };
const mainBtn: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none", cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" };

export default function IgChannels({ account = null, accounts, onReload, onBack, onToast, onUpsell }: {
  account?: AccountUser | null;
  accounts: IgAccount[];
  onReload: () => void | Promise<void>;
  onBack: () => void;
  onToast?: (msg: string, kind: "ok" | "err") => void;
  onUpsell: () => void;
}) {
  const t = useT();
  const coverage = useAccountCoverage(accounts.map((a) => a.igUserId).join(","));
  const limit = maxAcc(account?.plan || "free");
  const eligible = isFbEligible(account); // the same plan rule as Facebook
  const atCap = accounts.length >= limit;
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [authSession] = useState(() => nativeAuthSession());
  const [sheetOpen, setSheetOpen] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let alive = true;
    if (authTick === 0) setAuthUrl(null);
    if (!eligible) { setAuthUrl(null); return; }
    void startIgAuth(authSession ? { app: true } : {}).then((r) => { if (alive) setAuthUrl(r.ok && r.url ? r.url : null); });
    return () => { alive = false; };
  }, [eligible, authTick, authSession]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onReloadRef = useRef(onReload);
  useEffect(() => { onReloadRef.current = onReload; }, [onReload]);
  useEffect(() => {
    let last = 0;
    const back = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      void onReloadRef.current();
      setAuthTick((n) => n + 1);
    };
    const interval = window.setInterval(() => setAuthTick((n) => n + 1), IG_AUTH_REFRESH_MS);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, []);

  const authorizeInApp = async () => {
    if (!authSession || !authUrl || sheetOpen) return;
    setSheetOpen(true);
    let r: { status: string; code?: string };
    try { r = await authSession({ url: authUrl }); } catch { r = { status: "error" }; }
    setSheetOpen(false);
    setAuthTick((n) => n + 1);
    if (r.status === "connected" || r.status === "error") {
      const msg = igReturnText({ status: r.status, code: r.code }, t, limit);
      if (msg) onToast?.(msg, r.status === "connected" ? "ok" : "err");
    }
    await onReloadRef.current();
  };

  const remove = async (a: IgAccount) => {
    if (busyId) return;
    if (!window.confirm(t.rd_ig_remove_confirm)) return;
    setBusyId(a.id);
    await igDisconnect(a.igUserId); // stop its poller first — best effort
    const r = await removeIgAccount(a.id);
    setBusyId(null);
    if (r.ok) { onToast?.(t.rd_ig_removed_toast, "ok"); await onReload(); }
    else onToast?.(t.rd_ig_remove_err, "err");
  };

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: IG_BRAND, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>IG</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{t.rd_ig_channels_title}</div>
        </div>
      </div>
      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 14px" }}>{t.rd_ig_section_sub}</div>
        <AccountQuotaLine reloadKey={accounts.map((a) => a.id).join(",")} />
        {accounts.length === 0 ? (
          <div style={{ ...card, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>{t.rd_ig_no_accounts}</div>
        ) : accounts.map((a) => (
          <div key={a.id} data-testid="ig-account" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: IG_BRAND, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>IG</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.username ? `@${a.username}` : a.igUserId}</div>
              {a.pageName && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{a.pageName}</div>}
              {isCovered(coverage, "instagram", a.igUserId) === false && <div data-testid="not-covered" style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", marginTop: 2 }}>{notCoveredLabel(t, isIOS())}</div>}
            </div>
            <button onClick={() => void remove(a)} disabled={busyId === a.id} style={{ padding: "8px 13px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, cursor: busyId === a.id ? "default" : "pointer", opacity: busyId === a.id ? 0.6 : 1, fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_fb_remove}</button>
          </div>
        ))}
        {atCap && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "rgba(217,119,6,.1)", border: "1px solid var(--warn)", borderRadius: 10, padding: "9px 11px", margin: "4px 2px 12px" }}>{tpl(t.rd_ig_cap, { max: limit })}</div>}
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "6px 2px 10px" }}>{t.rd_ig_authorize_help}</div>
        {!eligible ? (
          <button onClick={onUpsell} style={mainBtn}>{t.rd_ig_authorize}</button>
        ) : authUrl && authSession ? (
          <button type="button" data-testid="ig-authorize-inapp" onClick={() => void authorizeInApp()} disabled={sheetOpen} style={{ ...mainBtn, opacity: sheetOpen ? 0.6 : 1 }}>{t.rd_ig_authorize}</button>
        ) : authUrl ? (
          <a data-testid="ig-authorize" href={authUrl} target="_blank" rel="noreferrer noopener" style={mainBtn}>{t.rd_ig_authorize}</a>
        ) : (
          <button disabled style={{ ...mainBtn, background: "var(--surface-3)", color: "var(--text-muted)", boxShadow: "none", cursor: "default" }}>{t.rd_fb_authorize_preparing}</button>
        )}
      </div>
    </div>
  );
}
