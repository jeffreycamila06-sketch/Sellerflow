// FACEBOOK LIVE — Phase 3. Manage Facebook pages screen (reached from ManageChannels'
// FB-pages section, only when fbEnabled = app_settings fb_enabled OR the owner-preview
// allowlist). Lists the seller's authorized pages, an "Authorize Facebook Page" action
// (a REAL <a> to the pre-fetched OAuth URL — iOS-safe, never window.open), and a
// per-page Remove (confirm). Origin-aware Back. Mirror of ShopeeChannels.
//
// ⚠️ GATES: Authorize needs an ACTIVE PAID plan (server also enforces it on connect) AND
// room under the plan cap (maxAcc, OWN page count — same numbers as TikTok; the fb_pages
// cap is SEPARATE from tiktok/facebook usernames, like Shopee). A cap hit shows a
// message; not-eligible routes to the neutral contact-support upsell.
import { useEffect, useState, type CSSProperties } from "react";
import { maxAcc } from "../adapters/connect";
import { startFbAuth, removeFbPage, isFbEligible, type FbPage } from "../adapters/fb";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px", marginBottom: 12, boxShadow: "var(--shadow)" };

export default function FbChannels({ account = null, pages, onReload, onBack, onToast, onUpsell }: {
  account?: AccountUser | null;
  pages: FbPage[]; // REAL authorized pages only (no placeholder) — Remove always acts on a real row
  onReload: () => void | Promise<void>;
  onBack: () => void;
  onToast?: (msg: string, kind: "ok" | "err") => void;
  onUpsell: () => void;
}) {
  const t = useT();
  const plan = account?.plan || "free";
  const limit = maxAcc(plan);
  const eligible = isFbEligible(account); // active-paid (admin bypass); Date.now lives in the module helper
  const atCap = pages.length >= limit;

  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pre-fetch the signed OAuth URL on mount so "Authorize" is a REAL anchor the seller
  // taps directly (the signed state has a ~10-min TTL). Fail → the button stays disabled.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let alive = true;
    setAuthUrl(null);
    if (!eligible) return;
    void startFbAuth().then((r) => { if (alive && r.ok && r.url) setAuthUrl(r.url); });
    return () => { alive = false; };
  }, [eligible]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const remove = async (id: string) => {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm(t.rd_fb_remove_confirm)) return;
    setBusyId(id);
    const r = await removeFbPage(id);
    setBusyId(null);
    if (r.ok) { onToast?.(t.rd_fb_removed_toast, "ok"); await onReload(); }
    else onToast?.(t.rd_fb_remove_err, "err");
  };

  const canAuthorize = eligible && !atCap && !!authUrl;

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
              </div>
              <button onClick={() => void remove(p.id)} disabled={busyId === p.id} style={{ padding: "8px 13px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, cursor: busyId === p.id ? "default" : "pointer", opacity: busyId === p.id ? 0.6 : 1, fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_fb_remove}</button>
            </div>
          ))
        )}

        {/* Cap message (own FB page count vs plan) */}
        {atCap && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "rgba(217,119,6,.1)", border: "1px solid var(--warn)", borderRadius: 10, padding: "9px 11px", margin: "4px 2px 12px" }}>{tpl(t.rd_fb_cap, { max: limit })}</div>}

        {/* Authorize — REAL anchor (pre-fetched signed URL); disabled at cap / while
            preparing / when not eligible (routes to the neutral upsell). */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "6px 2px 10px" }}>{t.rd_fb_authorize_help}</div>
        {!eligible ? (
          <button onClick={onUpsell} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" }}>{t.rd_fb_authorize}</button>
        ) : canAuthorize ? (
          <a href={authUrl!} target="_blank" rel="noreferrer noopener" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, textDecoration: "none", boxShadow: "0 6px 18px var(--accent-soft)" }}>{t.rd_fb_authorize}</a>
        ) : (
          <button disabled style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--surface-3)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "default" }}>{atCap ? t.rd_fb_authorize : t.rd_fb_authorize_preparing}</button>
        )}
      </div>
    </div>
  );
}
