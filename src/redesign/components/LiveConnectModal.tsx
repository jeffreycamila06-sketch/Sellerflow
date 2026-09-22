// LIVE CONNECT MODAL (Option E) — ONE consistent per-platform connect modal, opened
// from the Live Source sheet. Same header/layout for every platform:
//   • No account → Connect flow: one @username field + Connect.
//   • Account(s) → list: the live one shows ● Live, others show "Use"; + "＋ Add another".
//   • Facebook → activation-required gate (Telegram anchor; never green-connectable).
//   • Shopee → authorize a shop (navigates to ShopeeChannels), then shop + Live session id.
// ⚠️ Every connect/use/shopee action is handed UP to RedesignApp, which routes it through
// the session-aware path (commitLiveConnect) — this component NEVER calls liveFeed.connect
// or start_session itself.
import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";
import type { SourcePlatform } from "../adapters/liveSource";
import ChannelManageBody from "./ChannelManageBody";
import type { ChannelSaveFn } from "../adapters/useChannelEditor";
import type { AccountUser } from "../../accountDb";

const input: CSSProperties = { width: "100%", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const primary: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const rowCss: CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 9 };
const iconChip = (bg: string): CSSProperties => ({ width: 30, height: 30, borderRadius: 8, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" });

export interface ShopOpt { shopId: number; shopName: string }

export default function LiveConnectModal({
  platform, onClose, mode = "connect", account = null, onSaveChannels,
  ttAccounts, ttLiveName, onUseTikTok, onConnectTikTokNew,
  shopeeShops, shopeeLiveId, shopeeEligible, onAuthorizeShopee, onConnectShopee, onUpsell,
}: {
  platform: SourcePlatform;
  onClose: () => void;
  // "connect" (Live source flow — go live) | "manage" (Settings → Channels — edit/register
  // accounts, NEVER goes live). Default "connect" → existing callers byte-unchanged.
  mode?: "connect" | "manage";
  account?: AccountUser | null;            // manage mode: the profile whose accounts we edit
  onSaveChannels?: ChannelSaveFn;          // manage mode: the shared composeChannelSave path
  // TikTok
  ttAccounts: string[];
  ttLiveName: string | null;               // the account currently live (green), else null
  onUseTikTok: (username: string) => void;  // existing account → session-aware connect (continue)
  onConnectTikTokNew: (username: string) => void; // new @username → register + session-aware connect
  // Shopee
  shopeeShops: ShopOpt[];
  shopeeLiveId: number | null;
  shopeeEligible: boolean;
  onAuthorizeShopee: () => void;            // navigate to ShopeeChannels (authorize)
  onConnectShopee: (shopId: number, sessionId: string) => void;
  onUpsell: () => void;
}) {
  const t = useT();
  const [addOpen, setAddOpen] = useState(ttAccounts.length === 0); // no account → the add field is the whole flow
  const [newUser, setNewUser] = useState("");
  const [shopId, setShopId] = useState<number>(shopeeShops[0]?.shopId ?? 0);
  const [session, setSession] = useState("");

  const meta = platform === "Facebook" ? { bg: "#1877f2", ch: "f", name: t.rd_ls_facebook }
    : platform === "Shopee" ? { bg: "#ee4d2d", ch: "S", name: t.rd_ls_shopee }
    : platform === "Instagram" ? { bg: "#e1306c", ch: "i", name: t.rd_ls_instagram }
    : { bg: "#000", ch: "t", name: t.rd_ls_tiktok };

  const tiktok = (
    <>
      {ttAccounts.map((a) => {
        const live = a === ttLiveName;
        return (
          <div key={a} style={rowCss} data-testid="lc-tt-row">
            <span style={iconChip("#000")}>t</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a}</span>
            {live
              ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--ok, #16a34a)", flexShrink: 0 }} data-testid="lc-tt-live">● {t.rd_lc_live}</span>
              : <button onClick={() => onUseTikTok(a)} style={{ padding: "7px 15px", border: "1px solid var(--accent)", borderRadius: 9, background: "transparent", color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }} data-testid="lc-tt-use">{t.rd_lc_use}</button>}
          </div>
        );
      })}
      {addOpen ? (
        <div style={{ marginTop: ttAccounts.length ? 4 : 0 }}>
          <input value={newUser} onChange={(e) => setNewUser(e.target.value.replace(/^@+/, ""))} placeholder={t.rd_lc_tt_ph} autoCapitalize="none" style={{ ...input, marginBottom: 10 }} data-testid="lc-tt-input" />
          <button disabled={!newUser.trim()} onClick={() => onConnectTikTokNew(newUser.trim())} style={{ ...primary, opacity: newUser.trim() ? 1 : 0.55, cursor: newUser.trim() ? "pointer" : "default" }} data-testid="lc-tt-connect">{t.rd_lc_connect}</button>
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)} style={{ ...rowCss, width: "100%", cursor: "pointer", fontFamily: "var(--font-ui)", color: "var(--accent-fg)", fontWeight: 800, fontSize: 13.5 }} data-testid="lc-tt-add">＋ {t.rd_lc_add_another}</button>
      )}
    </>
  );

  const facebook = (
    <div style={{ ...rowCss, flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.rd_ls_fb_activation}</div>
      <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 0", background: "#0088cc", color: "#fff", borderRadius: 11, fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 800, textDecoration: "none" }} data-testid="lc-fb-telegram">{t.rd_ls_setup} →</a>
    </div>
  );

  const shopee = !shopeeEligible ? (
    <button onClick={onUpsell} style={primary} data-testid="lc-shopee-upsell">{t.rd_shp_authorize}</button>
  ) : shopeeShops.length === 0 ? (
    <button onClick={onAuthorizeShopee} style={primary} data-testid="lc-shopee-authorize">{t.rd_shp_authorize}</button>
  ) : (
    <div>
      {shopeeShops.length > 1 && (
        <select value={shopId} onChange={(e) => setShopId(Number(e.target.value))} style={{ ...input, marginBottom: 10 }} data-testid="lc-shopee-shop">
          {shopeeShops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName || `${t.rd_shp_shop_name_fallback} ${s.shopId}`}{s.shopId === shopeeLiveId ? " ●" : ""}</option>)}
        </select>
      )}
      <input value={session} onChange={(e) => setSession(e.target.value)} placeholder={t.rd_shp_session_ph} style={{ ...input, marginBottom: 8 }} data-testid="lc-shopee-session" />
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 12px" }}>{t.rd_shp_session_help}</div>
      <button disabled={!shopId || !session.trim()} onClick={() => onConnectShopee(shopId, session.trim())} style={{ ...primary, opacity: shopId && session.trim() ? 1 : 0.55, cursor: shopId && session.trim() ? "pointer" : "default" }} data-testid="lc-shopee-connect">{t.rd_lc_connect}</button>
    </div>
  );

  // MANAGE mode (Settings → Channels): edit/register accounts, NEVER connect. TikTok/FB
  // → the shared account editor; Shopee → shop list + Authorize (no session/connect);
  // Instagram → coming soon.
  const manage = platform === "TikTok" || platform === "Facebook" ? (
    <ChannelManageBody platform={platform === "TikTok" ? "tiktok" : "facebook"} account={account} onSaveChannels={onSaveChannels} ttLiveName={ttLiveName} />
  ) : platform === "Shopee" ? (
    shopeeShops.length === 0 ? (
      <button onClick={onAuthorizeShopee} style={primary} data-testid="cm-shopee-authorize">{t.rd_shp_authorize}</button>
    ) : (
      <div>
        {shopeeShops.map((s) => (
          <div key={s.shopId} style={rowCss} data-testid="cm-shopee-row">
            <span style={iconChip("#ee4d2d")}>S</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.shopName || `${t.rd_shp_shop_name_fallback} ${s.shopId}`}</span>
            {s.shopId === shopeeLiveId && <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--ok, #16a34a)", flexShrink: 0 }} data-testid="cm-shopee-live">● {t.rd_lc_live}</span>}
          </div>
        ))}
        <button onClick={onAuthorizeShopee} style={{ ...rowCss, width: "100%", cursor: "pointer", fontFamily: "var(--font-ui)", color: "var(--accent-fg)", fontWeight: 800, fontSize: 13.5, justifyContent: "flex-start" }} data-testid="cm-shopee-authorize">＋ {t.rd_shp_authorize}</button>
      </div>
    )
  ) : (
    <div style={{ ...rowCss, color: "var(--text-muted)", fontSize: 13, fontWeight: 700, justifyContent: "center" }} data-testid="cm-soon">{t.rd_ls_soon}</div>
  );

  const node = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1320, background: "rgba(9,7,24,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="lc-overlay">
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, maxHeight: "100%", overflowY: "auto", background: "var(--surface-2)", borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} data-testid="lc-modal">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 16px 13px", borderBottom: "1px solid var(--border)" }}>
          <span style={iconChip(meta.bg)}>{meta.ch}</span>
          <span style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{mode === "manage" ? t.rd_lc_manage : t.rd_lc_connect} {meta.name}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "var(--surface)", color: "var(--text-dim)", fontSize: 15, cursor: "pointer" }} data-testid="lc-close">×</button>
        </div>
        <div style={{ padding: 16 }}>
          {mode === "manage" ? manage : platform === "TikTok" ? tiktok : platform === "Facebook" ? facebook : shopee}
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
