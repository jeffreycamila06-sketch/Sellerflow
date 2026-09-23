// Manage [Platform] channels — the screen reached by tapping a Settings → Channels
// row (design-channels/SellerFlowLive.dc.html ttchannels/fbchannels). Plan-capped
// account rows: SAVED accounts = locked (tap → Telegram change request); empty rows
// up to the plan cap = the seller types their own @username, Save → persisted + locked.
// "Add … — Multi Account" → centered Telegram popup (admin-managed, beyond-cap).
//
// ⚠️ All editor state + the SAME safe save path (onSaveChannels → composeChannelSave →
// keepLockedAccounts + fitProfileAccounts, + touchSlot per cooldown-unlock) now live in
// the shared useChannelEditor hook — this screen is one of TWO consumers (the compact
// manage-mode LiveConnectModal is the other). Render only; logic is single-source.
import { useState, type CSSProperties } from "react";
import { unlockInHM } from "../adapters/tiktokCooldown";
import { useChannelEditor } from "../adapters/useChannelEditor";
import MultiAccountPopup from "../components/MultiAccountPopup";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
const USERNAME_RE = /^[a-z0-9._]*$/; // SOFT guidance only — never hard-blocks (matches main's accept-then-clean).

const input: CSSProperties = { flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, padding: "13px 0", outline: "none" };
const inputWrap = (invalid: boolean): CSSProperties => ({ flex: 1, display: "flex", alignItems: "center", gap: 4, border: `1px solid ${invalid ? "var(--warn)" : "var(--border-strong)"}`, borderRadius: 12, background: "var(--surface-2)", padding: "0 13px" });
const badge = (locked: boolean): CSSProperties => ({ display: "flex", alignItems: "center", padding: "0 16px", borderRadius: 12, background: locked ? "var(--surface-3)" : "var(--accent-soft)", color: locked ? "var(--text-muted)" : "var(--accent-fg)", fontSize: 12, fontWeight: 800, letterSpacing: ".04em", flexShrink: 0 });

export default function ManageChannels({ platform, account = null, onBack, onSaveChannels, shopeeEnabled = false, onShopee, fbPagesEnabled = false, onFbPages }: {
  platform: "tiktok" | "facebook";
  account?: AccountUser | null;
  onBack: () => void;
  // opts.unlocked = slot indices the 4h cooldown has server-verified as editable.
  onSaveChannels?: (lists: { tiktok: string; facebook: string }, opts?: { unlocked?: { tiktok?: number[]; facebook?: number[] } }) => Promise<{ ok: boolean; error?: string }>;
  // P3 — Shopee section (button → ShopeeChannels), rendered ONLY when the global
  // shopee_enabled flag is on. Absent/false → zero Shopee UI here (byte-unchanged).
  shopeeEnabled?: boolean;
  onShopee?: () => void;
  // F-P3 — Facebook Pages section (button → FbChannels OAuth screen), rendered ONLY when
  // fbEnabled (app_settings fb_enabled OR the owner-preview allowlist). Absent/false →
  // zero FB-pages UI here (byte-unchanged for every non-allowlisted seller). This is the
  // fb_pages live source, SEPARATE from the tiktok/facebook username cap above.
  fbPagesEnabled?: boolean;
  onFbPages?: () => void;
}) {
  const t = useT();
  // Editor state + save/cooldown logic = the shared hook (single source; see its header).
  const { isTT, orig, slots, setSlot, savedSlotView, unlock, atCap, dirty, save, state, err } = useChannelEditor(account, platform, onSaveChannels);
  const changeBtn: CSSProperties = { display: "flex", alignItems: "center", padding: "0 16px", borderRadius: 12, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent-fg)", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 };
  const [addOpen, setAddOpen] = useState(false);

  const title = isTT ? t.rd_ch_manage_tt_title : t.rd_ch_manage_fb_title;
  const rowLabel = isTT ? t.rd_ch_id_tiktok : t.rd_ch_fb_page_label;
  const helper = isTT ? t.rd_ch_validation : t.rd_ch_fb_helper;
  const addLabel = isTT ? t.rd_ch_add_tt_multi : t.rd_ch_add_fb_multi;
  const popBody = isTT ? t.rd_ch_pop_body_tt : t.rd_ch_pop_body_fb;

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: isTT ? "#000" : "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTT ? 13 : 14, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: isTT ? undefined : "var(--font-display)" }}>{isTT ? "t" : "f"}</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{title}</div>
        </div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        {slots.map((val, i) => {
          const savedSlot = Boolean(orig[i]);
          const view = savedSlot ? savedSlotView(i) : null;
          const locked = savedSlot ? !view!.editable : false; // empty slots are never "locked"
          const limitReached = !val && !savedSlot && atCap;
          const invalid = isTT && !!val && !USERNAME_RE.test(val);
          return (
            <div key={`${platform}-${i}`} style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", display: "block", marginBottom: 8 }}>{rowLabel} {i + 1}</label>
              <div style={{ display: "flex", gap: 9, alignItems: "stretch" }}>
                <div style={inputWrap(invalid)}>
                  {isTT && <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-muted)" }}>@</span>}
                  <input
                    value={val}
                    onChange={(e) => setSlot(i, e.target.value)}
                    disabled={locked || limitReached}
                    placeholder={limitReached ? t.rd_ch_limit_reached : isTT ? t.rd_ch_ph_tt : t.rd_ch_ph_fb}
                    style={{ ...input, opacity: locked || limitReached ? 0.6 : 1 }}
                  />
                </div>
                {/* LOCKED-AGAD (Option B — NO plan/upgrade badge): a changeable saved slot
                    shows a "Change" button; a cooling / fail-closed slot shows the LOCKED
                    badge; an editable (unlocked / admin) or empty slot shows nothing. */}
                {savedSlot && view!.canChange
                  ? <button onClick={() => unlock(i)} style={changeBtn} data-testid="mc-change">{t.rd_ch_change}</button>
                  : locked ? <span style={badge(true)}>{t.rd_ch_locked_badge}</span> : null}
              </div>
              {/* Cooling (<4h): live "Unlock in Xh Ym". */}
              {savedSlot && view!.note === "cooling" && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>{tpl(t.rd_ch_unlock_in, unlockInHM(view!.unlockMs))}</div>
              )}
              {/* Fail-closed (cooldown unknown): keep the tap→Telegram affordance. */}
              {savedSlot && locked && !view!.canChange && view!.note !== "cooling" && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5, cursor: "pointer" }} onClick={() => setAddOpen(true)}>{t.rd_ch_locked_note}</div>
              )}
            </div>
          );
        })}

        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "2px 2px 16px" }}>{helper}</div>

        {state === "error" && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", margin: "0 2px 10px" }}>{err}</div>}
        {state === "saved" && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)", margin: "0 2px 10px" }}>{t.rd_set_saved}</div>}
        {dirty && (
          <button onClick={save} disabled={state === "saving" || !onSaveChannels} style={{ width: "100%", padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: state === "saving" || !onSaveChannels ? "default" : "pointer", opacity: state === "saving" || !onSaveChannels ? 0.6 : 1, boxShadow: "0 5px 14px var(--accent-soft)", marginBottom: 12 }}>{state === "saving" ? t.rd_set_saving : t.rd_ch_save}</button>
        )}
        <button onClick={() => setAddOpen(true)} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" }}>{addLabel}</button>

        {/* P3 — Shopee shops section (flag-gated). A separate live source with its
            own authorize/remove screen; NOT part of the tiktok/facebook cap. */}
        {shopeeEnabled && onShopee && (
          <button onClick={onShopee} style={{ width: "100%", marginTop: 12, padding: "14px 15px", border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface)", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", fontFamily: "var(--font-ui)", boxShadow: "var(--shadow)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "#ee4d2d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0 }}>S</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_shp_section}</span><span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{t.rd_shp_section_sub}</span></span>
            <span style={{ fontSize: 15, color: "var(--text-muted)" }}>›</span>
          </button>
        )}

        {/* F-P3 — Facebook Pages section (fbEnabled-gated). Separate live source with its
            own authorize/remove OAuth screen; NOT part of the tiktok/facebook cap. */}
        {fbPagesEnabled && onFbPages && (
          <button onClick={onFbPages} style={{ width: "100%", marginTop: 12, padding: "14px 15px", border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface)", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", fontFamily: "var(--font-ui)", boxShadow: "var(--shadow)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", flexShrink: 0 }}>f</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_fb_channels_title}</span><span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{t.rd_fb_section_sub}</span></span>
            <span style={{ fontSize: 15, color: "var(--text-muted)" }}>›</span>
          </button>
        )}
      </div>

      {/* Shared "Add — Multi Account" Telegram popup (same component as the manage-mode modal). */}
      <MultiAccountPopup open={addOpen} onClose={() => setAddOpen(false)} title={addLabel} body={popBody} />
    </div>
  );
}
