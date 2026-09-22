// Compact Settings → Channels list (owner-gated). ONE tight row per platform —
// TikTok / Facebook / Shopee (TW market only) / Instagram — icon + name + subtitle
// + status + chevron. Tapping TikTok/Facebook/Shopee opens LiveConnectModal in
// "manage" mode (edit/register accounts, never goes live). Instagram = coming soon
// (not openable). Replaces the two big spaced-out channel cards for the owner; other
// sellers keep the classic rows until widen. Renders rows only — the card wrapper +
// section label live in GeneralSettings.
import { type CSSProperties } from "react";
import { useT } from "../i18n";
import { accountList } from "../adapters/connect";
import type { AccountUser } from "../../accountDb";

export type ManageChan = "tiktok" | "facebook" | "shopee";

const rowBtn = (disabled: boolean, last: boolean): CSSProperties => ({ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", border: "none", borderBottom: last ? "none" : "1px solid var(--border)", background: "transparent", cursor: disabled ? "default" : "pointer", textAlign: "left", fontFamily: "var(--font-ui)", opacity: disabled ? 0.6 : 1 });
const icon = (bg: string, display: boolean): CSSProperties => ({ width: 32, height: 32, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: display ? "var(--font-display)" : undefined });

export default function ChannelsList({ account, ttLive, showShopee, shopeeName = "", shopeeConnected = false, onOpen }: {
  account: AccountUser | null | undefined;
  ttLive: string | null;            // the TikTok account currently live (green), else null
  showShopee: boolean;              // TW market + owner-preview gate (computed in RedesignApp)
  shopeeName?: string;
  shopeeConnected?: boolean;
  onOpen: (platform: ManageChan) => void;
}) {
  const t = useT();
  const tt = accountList(account?.profile.tiktok || "");

  const row = (o: { key: string; bg: string; ch: string; display?: boolean; name: string; sub: string; count?: number; live?: boolean; onClick?: () => void; disabled?: boolean; last?: boolean }) => (
    <button onClick={o.onClick} disabled={o.disabled} data-testid={`cl-${o.key}`} style={rowBtn(!!o.disabled, !!o.last)}>
      <span style={icon(o.bg, !!o.display)}>{o.ch}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{o.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</div>
      </div>
      {o.live ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ok, #16a34a)", flexShrink: 0 }}>● {t.rd_lc_live}</span>
        : o.count ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", background: "var(--surface-2)", borderRadius: 8, padding: "2px 8px", flexShrink: 0 }}>{o.count}</span> : null}
      <span style={{ fontSize: 16, color: "var(--text-muted)", flexShrink: 0 }}>›</span>
    </button>
  );

  return (
    <>
      {row({ key: "tiktok", bg: "#000", ch: "t", name: t.rd_ls_tiktok, sub: tt.length ? `@${ttLive || tt[0]}` : t.rd_cl_tt_none, count: tt.length, live: !!ttLive, onClick: () => onOpen("tiktok") })}
      {row({ key: "facebook", bg: "#1877f2", ch: "f", display: true, name: t.rd_ls_facebook, sub: t.rd_ls_fb_activation, onClick: () => onOpen("facebook") })}
      {showShopee && row({ key: "shopee", bg: "#ee4d2d", ch: "S", name: t.rd_ls_shopee, sub: shopeeName || t.rd_shp_authorize, live: !!shopeeConnected, onClick: () => onOpen("shopee") })}
      {row({ key: "instagram", bg: "#e1306c", ch: "i", display: true, name: t.rd_ls_instagram, sub: t.rd_ls_soon, disabled: true, last: true })}
    </>
  );
}
