// Compact TikTok/Facebook account manager — the "manage" body rendered INSIDE
// LiveConnectModal (Settings → Channels, owner-gated). Same account editor as the
// full-screen ManageChannels, driven by the SHARED useChannelEditor hook (one save +
// cooldown source — no forked logic). Compact rows: saved accounts (● Live marker +
// edit-after-cooldown), then "＋ Add another account" up to the plan cap. Manage-only —
// NEVER connects / goes live (that stays in the Live-source flow).
import { useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { unlockInHM } from "../adapters/tiktokCooldown";
import { useChannelEditor, type ChannelSaveFn } from "../adapters/useChannelEditor";
import type { AccountUser } from "../../accountDb";

const rowCss: CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 8 };
const inp: CSSProperties = { width: "100%", padding: "11px 12px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const primary: CSSProperties = { width: "100%", padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, cursor: "pointer" };

export default function ChannelManageBody({ platform, account, onSaveChannels, ttLiveName }: {
  platform: "tiktok" | "facebook";
  account: AccountUser | null | undefined;
  onSaveChannels?: ChannelSaveFn;
  ttLiveName?: string | null;
}) {
  const t = useT();
  const { isTT, orig, slots, setSlot, savedSlotView, atCap, hasEditable, save, state, err } = useChannelEditor(account, platform, onSaveChannels);
  const savedCount = orig.filter(Boolean).length;
  const firstEmpty = orig.findIndex((v) => !v); // -1 = full (at plan cap)
  const [addOpen, setAddOpen] = useState(savedCount === 0); // no account yet → the add field is the whole flow

  return (
    <div data-testid="cm-body">
      {orig.map((saved, i) => {
        if (!saved) return null; // empty slots are handled by the Add flow below
        const view = savedSlotView(i);
        const live = isTT && ttLiveName != null && saved === ttLiveName;
        return (
          <div key={`${platform}-${i}`} style={rowCss} data-testid="cm-row">
            <span style={{ width: 28, height: 28, borderRadius: 8, background: isTT ? "#000" : "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTT ? 13 : 14, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: isTT ? undefined : "var(--font-display)" }}>{isTT ? "t" : "f"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {view.editable ? (
                <input value={slots[i]} onChange={(e) => setSlot(i, e.target.value.replace(/^@+/, ""))} autoCapitalize="none" style={{ ...inp, padding: "8px 10px", fontSize: 13.5 }} data-testid="cm-edit" />
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isTT ? "@" : ""}{saved}</div>
                  {view.note === "cooling" && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(t.rd_ch_unlock_in, unlockInHM(view.unlockMs))}</div>}
                </>
              )}
            </div>
            {live
              ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--ok, #16a34a)", flexShrink: 0 }} data-testid="cm-live">● {t.rd_lc_live}</span>
              : !view.editable ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", flexShrink: 0 }} data-testid="cm-locked">{t.rd_ch_locked_badge}</span> : null}
          </div>
        );
      })}

      {/* Add another account (up to the plan cap) — progressive reveal of the next empty slot. */}
      {firstEmpty >= 0 && !atCap && (addOpen ? (
        <input value={slots[firstEmpty]} onChange={(e) => setSlot(firstEmpty, e.target.value.replace(/^@+/, ""))} placeholder={isTT ? t.rd_ch_ph_tt : t.rd_ch_ph_fb} autoCapitalize="none" style={{ ...inp, marginTop: savedCount ? 4 : 0, marginBottom: 10 }} data-testid="cm-add-input" />
      ) : (
        <button onClick={() => setAddOpen(true)} style={{ ...rowCss, width: "100%", cursor: "pointer", fontFamily: "var(--font-ui)", color: "var(--accent-fg)", fontWeight: 800, fontSize: 13.5, justifyContent: "flex-start" }} data-testid="cm-add">＋ {t.rd_lc_add_another}</button>
      ))}

      {state === "error" && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", margin: "2px 2px 8px" }}>{err}</div>}
      {state === "saved" && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)", margin: "2px 2px 8px" }}>{t.rd_set_saved}</div>}
      {hasEditable && (
        <button onClick={save} disabled={state === "saving"} style={{ ...primary, marginTop: 4, opacity: state === "saving" ? 0.6 : 1 }} data-testid="cm-save">{state === "saving" ? t.rd_set_saving : t.rd_ch_save}</button>
      )}
    </div>
  );
}
