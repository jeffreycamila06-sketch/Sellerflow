// FACEBOOK LIVE — Phase 3. Manage Facebook pages screen (reached from ManageChannels'
// FB-pages section, only when fbEnabled = app_settings fb_enabled OR the owner-preview
// allowlist). Lists the seller's authorized pages, an "Authorize Facebook Page" action
// (a REAL <a> to the pre-fetched OAuth URL — iOS-safe, never window.open), and a
// per-page Remove (confirm). Origin-aware Back. Mirror of ShopeeChannels.
//
// ⚠️ GATES: Authorize needs an ACTIVE plan — free or paid (isFbEligible; the server enforces
// requirePlanActive on connect) AND
// room under the plan cap (maxAcc, OWN page count — same numbers as TikTok; the fb_pages
// cap is SEPARATE from tiktok/facebook usernames, like Shopee). A cap hit shows a
// message but Authorize stays enabled: re-authorizing an existing page is always allowed
// (the server refuses only a NEW page over the cap → ?fb=error&code=cap).
// not-eligible routes to the neutral contact-support upsell.
// While this screen is open, coming back to the app (tab visible / window focused — the
// seller returns from Facebook in another tab or the system browser) reloads the page list
// and refreshes the Authorize link; the link is also refreshed every 8 minutes (the signed
// state lasts 10).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { maxAcc } from "../adapters/connect";
import { startFbAuth, removeFbPage, fbDisconnect, isFbEligible, nativeAuthSession, fbReturnText, type FbPage } from "../adapters/fb";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
import { useLang } from "../i18n/langContext";
import AccountQuotaLine from "../components/AccountQuotaLine";
import { useAccountCoverage, isCovered, notCoveredLabel } from "../adapters/accountLive";
import { accountLimitMessage } from "../adapters/accountQuota";
import { planLabel } from "../adapters/useAuthSession";
import { isIOS } from "../adapters/platform";

export const FB_AUTH_REFRESH_MS = 8 * 60 * 1000;
// fb_polish_v2: "Preparing…" gives up after this long → "Try again" (a failed fetch shows it at once).
export const FB_AUTH_PREPARE_TIMEOUT_MS = 15 * 1000;

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px", marginBottom: 12, boxShadow: "var(--shadow)" };

export default function FbChannels({ account = null, pages, onReload, onBack, onToast, onUpsell, needsReconnectIds = [], polish = false }: {
  account?: AccountUser | null;
  pages: FbPage[]; // REAL authorized pages only (no placeholder) — Remove always acts on a real row
  onReload: () => void | Promise<void>;
  onBack: () => void;
  onToast?: (msg: string, kind: "ok" | "err") => void;
  onUpsell: () => void;
  // fb_stop_reasons (switch ON): Pages whose access ended → "Needs reconnect" + Reconnect
  // (the same Authorize flow as the button below). Absent / empty = the rows as before.
  needsReconnectIds?: string[];
  // fb_polish_v2 (Build 5): the confirm page in the app's language, own texts per return code,
  // and "Try again" when the link can't be prepared. Off → this screen exactly as before.
  polish?: boolean;
}) {
  const t = useT();
  const coverage = useAccountCoverage(pages.map((p) => p.pageId).join(",")); // Build 2: "not covered" labels (enforcing + over-limit only)
  const lang = useLang();
  const plan = account?.plan || "free";
  const limit = maxAcc(plan);
  const eligible = isFbEligible(account); // any active plan, free or paid (admin bypass); Date.now lives in the module helper
  const atCap = pages.length >= limit;

  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);   // bump → fetch a fresh Authorize link
  const [busyId, setBusyId] = useState<string | null>(null);
  // New app builds: Authorize opens Facebook in the in-app sign-in sheet, which closes by itself
  // after "Connect". Old builds / normal browsers: null → the unchanged <a target="_blank">.
  const [authSession] = useState(() => nativeAuthSession());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [authFailed, setAuthFailed] = useState(false); // fb_polish_v2 only
  const confirmLang = polish ? lang : ""; // the confirm page's language (off → not sent)

  // Pre-fetch the signed OAuth URL so "Authorize" is a REAL anchor the seller taps directly
  // (the signed state has a ~10-min TTL). A refresh keeps the current link until the new one
  // arrives; a failed fetch clears it (never hand out an expired link) → the button disables.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let alive = true;
    if (authTick === 0) setAuthUrl(null);
    if (!eligible) { setAuthUrl(null); return; }
    const opts = { ...(authSession ? { app: true } : {}), ...(confirmLang ? { lang: confirmLang } : {}) };
    void startFbAuth(opts).then((r) => {
      if (!alive) return;
      setAuthUrl(r.ok && r.url ? r.url : null);
      if (polish) setAuthFailed(!(r.ok && r.url));
    });
    return () => { alive = false; };
  }, [eligible, authTick, authSession, polish, confirmLang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // fb_polish_v2: still no link after FB_AUTH_PREPARE_TIMEOUT_MS → "Try again".
  useEffect(() => {
    if (!polish || !eligible || authUrl || authFailed) return;
    const id = window.setTimeout(() => setAuthFailed(true), FB_AUTH_PREPARE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [polish, eligible, authUrl, authFailed, authTick]);
  const retryAuth = () => { setAuthFailed(false); setAuthTick((n) => n + 1); };

  // Back in the app (visible / focused) → reload the page list + a fresh link. Both events fire
  // on one return, so a second call within 1 s is skipped. Plus a fresh link every 8 minutes.
  const onReloadRef = useRef(onReload);
  useEffect(() => { onReloadRef.current = onReload; }, [onReload]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = 0;
    const back = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      void onReloadRef.current();
      setAuthTick((n) => n + 1);
    };
    const interval = window.setInterval(() => setAuthTick((n) => n + 1), FB_AUTH_REFRESH_MS);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, []);

  // In-app sheet: one at a time. The signed link is used up either way → fetch a fresh one.
  const authorizeInApp = async () => {
    if (!authSession || !authUrl || sheetOpen) return;
    setSheetOpen(true);
    let r: { status: string; code?: string };
    try { r = await authSession({ url: authUrl }); } catch { r = { status: "error" }; }
    setSheetOpen(false);
    setAuthTick((n) => n + 1);
    if (r.status === "connected") {
      onToast?.(fbReturnText({ status: "connected" }, t, limit, polish) || "", "ok");
    } else if (r.status === "error" && r.code === "account_limit") {
      onToast?.(await accountLimitMessage(t, { ios: isIOS(), planName: planLabel(plan), lang }), "err");
    } else if (r.status === "error") {
      const msg = fbReturnText({ status: "error", code: r.code }, t, limit, polish);
      if (msg) onToast?.(msg, "err");
    }
    // cancelled / busy → nothing to show.
    // Reload the list after EVERY result: the Page may already be saved when the seller closes
    // the sheet by hand (flow finished on the web page inside the sheet, or the callback was not
    // caught), and on iOS no focus / visible event fires when an in-app sheet closes.
    await onReloadRef.current();
  };

  const remove = async (p: FbPage) => {
    const id = p.id;
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm(t.rd_fb_remove_confirm)) return;
    setBusyId(id);
    await fbDisconnect(p.pageId).catch(() => null); // stop its poller first — best effort
    const r = await removeFbPage(id);
    setBusyId(null);
    if (r.ok) { onToast?.(t.rd_fb_removed_toast, "ok"); await onReload(); }
    else onToast?.(t.rd_fb_remove_err, "err");
  };

  const canAuthorize = eligible && !!authUrl;
  // fb_stop_reasons — the warn "Connect again" badge IS the tap target: the Authorize flow below,
  // same four forms (upsell / in-app sheet / real anchor, iOS-safe / plain while preparing).
  const reconnectStyle: CSSProperties = { display: "inline-block", fontSize: 11, fontWeight: 800, color: "var(--warn)", background: "none", border: "1px solid var(--warn)", borderRadius: 6, padding: "2px 7px", textDecoration: "none", cursor: "pointer", fontFamily: "var(--font-ui)" };
  const reconnectControl = !eligible ? (
    <button type="button" data-testid="fb-needs-reconnect" onClick={onUpsell} style={reconnectStyle}>{t.rd_fb_needs_reconnect}</button>
  ) : canAuthorize && authSession ? (
    <button type="button" data-testid="fb-needs-reconnect" onClick={() => void authorizeInApp()} disabled={sheetOpen} style={reconnectStyle}>{t.rd_fb_needs_reconnect}</button>
  ) : canAuthorize ? (
    <a data-testid="fb-needs-reconnect" href={authUrl!} target="_blank" rel="noreferrer noopener" style={reconnectStyle}>{t.rd_fb_needs_reconnect}</a>
  ) : (
    <span data-testid="fb-needs-reconnect" style={{ ...reconnectStyle, cursor: "default", opacity: 0.6 }}>{t.rd_fb_needs_reconnect}</span>
  );

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", flexShrink: 0 }}>f</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{t.rd_fb_channels_title}</div>
        </div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 14px" }}>{t.rd_fb_section_sub}</div>
        <AccountQuotaLine reloadKey={pages.map((p) => p.id).join(",")} />

        {/* Authorized pages */}
        {pages.length === 0 ? (
          <div style={{ ...card, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>{t.rd_fb_no_pages}</div>
        ) : (
          pages.map((p) => (
            <div key={p.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, color: "#fff", flexShrink: 0 }}>f</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || t.rd_fb_page_name_fallback}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.username ? `@${p.username}` : `${t.rd_fb_page_id}: ${p.pageId}`}</div>
                {isCovered(coverage, "facebook", String(p.pageId)) === false && <div data-testid="not-covered" style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", marginTop: 2 }}>{notCoveredLabel(t, isIOS())}</div>}
                {needsReconnectIds.includes(p.pageId) && <div style={{ marginTop: 4 }}>{reconnectControl}</div>}
              </div>
              <button onClick={() => void remove(p)} disabled={busyId === p.id} style={{ padding: "8px 13px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, cursor: busyId === p.id ? "default" : "pointer", opacity: busyId === p.id ? 0.6 : 1, fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_fb_remove}</button>
            </div>
          ))
        )}

        {/* Cap message (own FB page count vs plan) */}
        {atCap && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "rgba(217,119,6,.1)", border: "1px solid var(--warn)", borderRadius: 10, padding: "9px 11px", margin: "4px 2px 12px" }}>{tpl(t.rd_fb_cap, { max: limit })}</div>}

        {/* Authorize — REAL anchor (pre-fetched signed URL); stays enabled at the cap
            (re-authorizing an existing page); disabled only while preparing; not eligible
            routes to the neutral upsell. */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "6px 2px 10px" }}>{t.rd_fb_authorize_help}</div>
        {!eligible ? (
          <button onClick={onUpsell} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" }}>{t.rd_fb_authorize}</button>
        ) : canAuthorize && authSession ? (
          <button type="button" data-testid="fb-authorize-inapp" onClick={() => void authorizeInApp()} disabled={sheetOpen} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: sheetOpen ? "default" : "pointer", opacity: sheetOpen ? 0.6 : 1, boxShadow: "0 6px 18px var(--accent-soft)" }}>{t.rd_fb_authorize}</button>
        ) : canAuthorize ? (
          <a href={authUrl!} target="_blank" rel="noreferrer noopener" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none", boxShadow: "0 6px 18px var(--accent-soft)" }}>{t.rd_fb_authorize}</a>
        ) : polish && authFailed ? (
          <>
            <div data-testid="fb-open-failed" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", margin: "0 2px 8px" }}>{t.rd_fb_open_failed}</div>
            <button type="button" data-testid="fb-authorize-retry" onClick={retryAuth} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>{t.rd_fb_try_again}</button>
          </>
        ) : (
          <button disabled style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--surface-3)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "default" }}>{t.rd_fb_authorize_preparing}</button>
        )}
      </div>
    </div>
  );
}
