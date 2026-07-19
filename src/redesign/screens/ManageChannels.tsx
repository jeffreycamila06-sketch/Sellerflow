// Manage [Platform] channels — the screen reached by tapping a Settings → Channels
// row (design-channels/SellerFlowLive.dc.html ttchannels/fbchannels). Plan-capped
// account rows: SAVED accounts = locked (tap → Telegram change request); empty rows
// up to the plan cap = the seller types their own @username, Save → persisted + locked.
// "Add … — Multi Account" → centered Telegram popup (admin-managed, beyond-cap).
//
// ⚠️ Account writes go through the SAME safe path as Step 3 (onSaveChannels →
// composeChannelSave → keepLockedAccounts + fitProfileAccounts → upsertUser). This
// screen only edits THIS platform's slots and passes the other platform's saved value
// through unchanged, so the combined-cap + locked guards still apply.
import { useEffect, useState, type CSSProperties } from "react";
import { accountSlots, accountList, accountText, maxAcc } from "../adapters/connect";
import type { AccountUser } from "../../accountDb";
import { useT } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";
const USERNAME_RE = /^[a-z0-9._]*$/; // SOFT guidance only — never hard-blocks (matches main's accept-then-clean).

const input: CSSProperties = { flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, padding: "13px 0", outline: "none" };
const inputWrap = (invalid: boolean): CSSProperties => ({ flex: 1, display: "flex", alignItems: "center", gap: 4, border: `1px solid ${invalid ? "var(--warn)" : "var(--border-strong)"}`, borderRadius: 12, background: "var(--surface-2)", padding: "0 13px" });
const badge = (locked: boolean): CSSProperties => ({ display: "flex", alignItems: "center", padding: "0 16px", borderRadius: 12, background: locked ? "var(--surface-3)" : "var(--accent-soft)", color: locked ? "var(--text-muted)" : "var(--accent-fg)", fontSize: 12, fontWeight: 800, letterSpacing: ".04em", flexShrink: 0 });

export default function ManageChannels({ platform, account = null, onBack, onSaveChannels }: {
  platform: "tiktok" | "facebook";
  account?: AccountUser | null;
  onBack: () => void;
  onSaveChannels?: (lists: { tiktok: string; facebook: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useT();
  const isTT = platform === "tiktok";
  const field = platform; // "tiktok" | "facebook"
  const other: "tiktok" | "facebook" = isTT ? "facebook" : "tiktok";
  const limit = maxAcc(account?.plan || "free");
  const planBadge = (account?.plan || "free").toUpperCase();
  const orig = accountSlots(account?.profile[field] || "", limit);
  const [slots, setSlots] = useState<string[]>(orig);
  const [addOpen, setAddOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  useEffect(() => { setSlots(accountSlots(account?.profile[field] || "", limit)); setState("idle"); setErr(""); }, [account, limit, field]);

  // Combined cap across BOTH platforms (this platform's live drafts + the other's saved).
  const otherCount = accountList(account?.profile[other] || "").length;
  const atCap = otherCount + accountList(slots.join("\n")).length >= limit;
  const setSlot = (i: number, v: string) => { setSlots((s) => s.map((x, idx) => (idx === i ? v : x))); setState("idle"); };
  const hasEditable = slots.some((_, i) => !orig[i]);

  const save = async () => {
    if (!onSaveChannels || state === "saving") return;
    setState("saving"); setErr("");
    // Edit THIS platform; pass the other platform's saved value through unchanged.
    const lists = isTT
      ? { tiktok: accountText(slots), facebook: account?.profile.facebook || "" }
      : { tiktok: account?.profile.tiktok || "", facebook: accountText(slots) };
    const r = await onSaveChannels(lists);
    if (r.ok) setState("saved"); else { setState("error"); setErr(r.error || t.rd_set_err_save_failed); }
  };

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
          const locked = Boolean(orig[i]);
          const limitReached = !val && !locked && atCap;
          const invalid = isTT && !!val && !USERNAME_RE.test(val);
          return (
            <div key={`${field}-${i}`} style={{ marginBottom: 16 }}>
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
                <span style={badge(locked)}>{locked ? t.rd_ch_locked_badge : planBadge}</span>
              </div>
              {locked && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5, cursor: "pointer" }} onClick={() => setAddOpen(true)}>{t.rd_ch_locked_note}</div>}
            </div>
          );
        })}

        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "2px 2px 16px" }}>{helper}</div>

        {state === "error" && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", margin: "0 2px 10px" }}>{err}</div>}
        {state === "saved" && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)", margin: "0 2px 10px" }}>{t.rd_set_saved}</div>}
        {hasEditable && (
          <button onClick={save} disabled={state === "saving" || !onSaveChannels} style={{ width: "100%", padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: state === "saving" || !onSaveChannels ? "default" : "pointer", opacity: state === "saving" || !onSaveChannels ? 0.6 : 1, boxShadow: "0 5px 14px var(--accent-soft)", marginBottom: 12 }}>{state === "saving" ? t.rd_set_saving : t.rd_ch_save}</button>
        )}
        <button onClick={() => setAddOpen(true)} style={{ width: "100%", padding: "15px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" }}>{addLabel}</button>
      </div>

      {/* Centered Telegram popup (redesign-themed, NOT the source yellow) */}
      {addOpen && (
        <div onClick={(e) => e.target === e.currentTarget && setAddOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
          <div style={{ width: "100%", maxWidth: 300, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden" }}>
            <div style={{ padding: "22px 20px 18px" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)", lineHeight: 1.25 }}>{addLabel}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, marginTop: 9 }}>{popBody}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 9 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.rd_ch_tg_handle}</span>
              </div>
            </div>
            <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setAddOpen(false)} style={{ flex: 1, padding: "15px 0", border: "none", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t.rd_ch_cancel}</button>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={() => setAddOpen(false)} style={{ flex: 1, padding: "15px 0", background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{t.rd_ch_ok}<span style={{ fontSize: 15 }}>→</span></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
