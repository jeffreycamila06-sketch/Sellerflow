// Compact TikTok/Facebook account manager — the "manage" body rendered INSIDE
// LiveConnectModal (Settings → Channels, owner-gated). Same account editor as the
// full-screen ManageChannels, driven by the SHARED useChannelEditor hook (one save +
// cooldown source — no forked logic).
//
// OPTION B (2026-09-23): show EXACTLY maxAccountsForPlan slots — no teaser/+1, no plan
// (PLUS/PRO/MASTER) badges. Saved slot = 🔒 @handle + "Change" (locked-agad: tap Change
// → editable → Save → 4h server lock; cooling shows "Unlock in Xh", no Change). Empty
// slot (within cap) = directly-typeable @username. "Add — Multi Account" Telegram anchor
// at the bottom (all plans). Manage-only — NEVER connects / goes live; save → close.
//
// ⚠️ ANTI-ABUSE: "Change" is a UI reveal ONLY; save() still calls touchSlot and the
// server RAISES cooldown_active (<4h, non-admin) → save aborts. Not bypassable.
import { useEffect, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { unlockInHM } from "../adapters/tiktokCooldown";
import { useChannelEditor, type ChannelSaveFn } from "../adapters/useChannelEditor";
import { TELEGRAM_URL } from "../../lib/telegram";
import type { AccountUser } from "../../accountDb";

const rowCss: CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 8 };
const inp: CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const primary: CSSProperties = { width: "100%", padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const changeBtn: CSSProperties = { padding: "6px 13px", border: "1px solid var(--accent)", borderRadius: 9, background: "transparent", color: "var(--accent-fg)", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 };
const lockBadge: CSSProperties = { display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 800, color: "var(--text-muted)", flexShrink: 0 };
const note: CSSProperties = { fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 };
const handleText: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const multiBtn: CSSProperties = { display: "block", textAlign: "center", textDecoration: "none", marginTop: 6, padding: "12px 0", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 800 };

export default function ChannelManageBody({ platform, account, onSaveChannels, ttLiveName, onSaved }: {
  platform: "tiktok" | "facebook";
  account: AccountUser | null | undefined;
  onSaveChannels?: ChannelSaveFn;
  ttLiveName?: string | null;
  onSaved?: () => void; // success closes the modal (the confirmation signal)
}) {
  const t = useT();
  const { isTT, orig, slots, setSlot, savedSlotView, unlock, atCap, dirty, save, state, err } = useChannelEditor(account, platform, onSaveChannels);
  const addLabel = isTT ? t.rd_ch_add_tt_multi : t.rd_ch_add_fb_multi;

  // A SUCCESSFUL save closes the modal. A failure (cooldown_active / error) keeps it open
  // with the inline error below.
  useEffect(() => { if (state === "saved") onSaved?.(); }, [state, onSaved]);

  return (
    <div data-testid="cm-body">
      {/* EXACTLY maxAccountsForPlan slots (orig is padded to the plan cap). No teaser, no badges. */}
      {orig.map((saved, i) => {
        const savedSlot = Boolean(saved);
        const view = savedSlot ? savedSlotView(i) : null;
        const locked = savedSlot ? !view!.editable : false;
        const limitReached = !slots[i] && !savedSlot && atCap; // combined-cap empty slot → disabled
        const live = savedSlot && isTT && ttLiveName != null && saved === ttLiveName;
        return (
          <div key={`${platform}-${i}`} style={rowCss} data-testid="cm-row">
            <span style={{ width: 28, height: 28, borderRadius: 8, background: isTT ? "#000" : "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTT ? 13 : 14, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: isTT ? undefined : "var(--font-display)" }}>{isTT ? "t" : "f"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {savedSlot && !view!.editable ? (
                <>
                  <div style={handleText}>{isTT ? "@" : ""}{saved}</div>
                  {view!.note === "cooling" && <div style={note} data-testid="cm-cooling">{tpl(t.rd_ch_unlock_in, unlockInHM(view!.unlockMs))}</div>}
                </>
              ) : (
                // Empty slot (typeable, disabled at cap) OR a saved slot unlocked via Change / admin.
                <input value={slots[i]} onChange={(e) => setSlot(i, e.target.value.replace(/^@+/, ""))} disabled={limitReached} placeholder={limitReached ? t.rd_ch_limit_reached : isTT ? t.rd_ch_ph_tt : t.rd_ch_ph_fb} autoCapitalize="none" style={{ ...inp, opacity: limitReached ? 0.6 : 1 }} data-testid={savedSlot ? "cm-edit" : "cm-empty"} />
              )}
            </div>
            {live ? (
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--ok, #16a34a)", flexShrink: 0 }} data-testid="cm-live">● {t.rd_lc_live}</span>
            ) : savedSlot && view!.canChange ? (
              <button onClick={() => unlock(i)} style={changeBtn} data-testid="cm-change">{t.rd_ch_change}</button>
            ) : savedSlot && locked ? (
              <span style={lockBadge} data-testid="cm-locked">🔒 {t.rd_ch_locked_badge}</span>
            ) : null /* empty / editable → no badge (Option B: no plan badges) */}
          </div>
        );
      })}

      {state === "error" && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", margin: "2px 2px 8px" }} data-testid="cm-error">{err}</div>}
      {dirty && (
        <button onClick={save} disabled={state === "saving"} style={{ ...primary, marginTop: 4, opacity: state === "saving" ? 0.6 : 1 }} data-testid="cm-save">{state === "saving" ? t.rd_set_saving : t.rd_ch_save}</button>
      )}

      {/* Add — Multi Account: Telegram (all plans), iOS-safe anchor (beyond-cap / help). */}
      <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" style={multiBtn} data-testid="cm-multi">{addLabel}</a>
    </div>
  );
}
