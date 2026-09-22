// LIVE SOURCE SHEET (Option E) — a bottom sheet listing every live-comment source,
// ONE active at a time. TikTok / Shopee are connectable (tap → RedesignApp.switchSource
// → confirm on a platform switch → ConnectModal). Facebook = the honest "activation
// required" gate (Telegram anchor, never a green-able connect — Meta 2.1b posture).
// Instagram = "coming soon" placeholder. The sheet CLOSES on a pick (RedesignApp calls
// onClose synchronously before firing connect); the compact header button then shows
// the connecting→connected status.
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";
import type { SourcePlatform } from "../adapters/liveSource";

const iconChip = (bg: string): CSSProperties => ({ width: 34, height: 34, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" });
const row: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface)", marginBottom: 9, textAlign: "left", fontFamily: "var(--font-ui)", boxShadow: "var(--shadow)" };
const nameCss: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const subCss: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function StatusDot({ connected, connecting }: { connected?: boolean; connecting?: boolean }) {
  const bg = connected ? "#4ade80" : connecting ? "#fbbf24" : "var(--border-strong)";
  const glow = connected ? "0 0 6px rgba(74,222,128,.9)" : "none";
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: bg, boxShadow: glow, flexShrink: 0 }} />;
}

export interface SourceState { name: string; connected: boolean; connecting: boolean }

export default function LiveSourceSheet({
  open, onClose, active, tiktok, shopee, showShopee, onPickTikTok, onPickShopee,
}: {
  open: boolean;
  onClose: () => void;
  active: SourcePlatform;
  tiktok: SourceState;
  shopee: SourceState;
  showShopee: boolean;              // TW market + shopee_enabled/owner-preview
  onPickTikTok: () => void;
  onPickShopee: () => void;
}) {
  const t = useT();
  if (!open) return null;

  const activeRing = (on: boolean): CSSProperties => on ? { border: "1.5px solid var(--accent)", boxShadow: "0 0 0 3px var(--accent-soft)" } : {};
  const statusText = (s: SourceState) => s.connected ? t.rd_ls_connected : s.connecting ? t.rd_ls_connecting : (s.name || t.rd_ls_not_connected);

  const node = (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      data-testid="livesource-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}
        data-testid="livesource-sheet"
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em", color: "var(--text-muted)", margin: "0 2px 12px" }}>{t.rd_ls_title}</div>

        {/* TikTok — connectable */}
        <button onClick={onPickTikTok} style={{ ...row, ...activeRing(active === "TikTok") }} data-testid="livesource-tiktok">
          <span style={iconChip("#000")}>t</span>
          <span style={{ flex: 1, minWidth: 0 }}><span style={nameCss}>{t.rd_ls_tiktok}</span><span style={{ ...subCss, display: "block" }}>{statusText(tiktok)}</span></span>
          <StatusDot connected={tiktok.connected} connecting={tiktok.connecting} />
        </button>

        {/* Facebook — HONEST GATE: activation required, never a green-able connect */}
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onClose} style={{ ...row, textDecoration: "none" }} data-testid="livesource-facebook">
          <span style={iconChip("#1877f2")}>f</span>
          <span style={{ flex: 1, minWidth: 0 }}><span style={nameCss}>{t.rd_ls_facebook}</span><span style={{ ...subCss, display: "block" }}>{t.rd_ls_fb_activation}</span></span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#0088cc", flexShrink: 0 }}>{t.rd_ls_setup} →</span>
        </a>

        {/* Shopee — connectable, TW market only */}
        {showShopee && (
          <button onClick={onPickShopee} style={{ ...row, ...activeRing(active === "Shopee") }} data-testid="livesource-shopee">
            <span style={iconChip("#ee4d2d")}>S</span>
            <span style={{ flex: 1, minWidth: 0 }}><span style={nameCss}>{t.rd_ls_shopee}</span><span style={{ ...subCss, display: "block" }}>{statusText(shopee)}</span></span>
            <StatusDot connected={shopee.connected} connecting={shopee.connecting} />
          </button>
        )}

        {/* Instagram — coming soon placeholder (disabled) */}
        <div style={{ ...row, opacity: 0.55, cursor: "default" }} data-testid="livesource-instagram">
          <span style={iconChip("#c13584")}>IG</span>
          <span style={{ flex: 1, minWidth: 0 }}><span style={nameCss}>{t.rd_ls_instagram}</span><span style={{ ...subCss, display: "block" }}>{t.rd_ls_soon}</span></span>
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
