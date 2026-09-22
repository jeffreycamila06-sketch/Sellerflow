// Shared Channels editor logic — the SINGLE source of the plan-capped, 4h-cooldown
// account save. Extracted VERBATIM from ManageChannels (its lines 39–132) so the
// full-screen editor AND the new compact manage-mode modal drive one implementation
// (no forked security path). Behavior is byte-identical; only the RENDER differs
// per consumer. Guarded by the existing ManageChannels + cooldown test suites.
//
// ⚠️ Account writes still go through onSaveChannels → composeChannelSave
// (keepLockedAccounts + fitProfileAccounts + admin bypass) and touchSlot for each
// server-verified cooldown unlock — this hook never writes accounts directly.
import { useEffect, useState } from "react";
import { accountSlots, accountList, accountText, maxAcc } from "./connect";
import { fetchSlotCooldowns, touchSlot, slotLockState, slotKey, WINDOW_MS, type SlotCooldowns } from "./tiktokCooldown";
import { isAdminRole } from "../../lib/roles";
import type { AccountUser } from "../../accountDb";
import { useT } from "../i18n";

export type SavedSlotView = { editable: boolean; note: "cooling" | "window" | "telegram"; unlockMs: number };
export type ChannelSaveFn = (lists: { tiktok: string; facebook: string }, opts?: { unlocked?: { tiktok?: number[]; facebook?: number[] } }) => Promise<{ ok: boolean; error?: string }>;

export function useChannelEditor(account: AccountUser | null | undefined, platform: "tiktok" | "facebook", onSaveChannels?: ChannelSaveFn) {
  const t = useT();
  const isTT = platform === "tiktok";
  const field = platform; // "tiktok" | "facebook"
  const other: "tiktok" | "facebook" = isTT ? "facebook" : "tiktok";
  const isAdmin = isAdminRole(account?.role);
  const limit = maxAcc(account?.plan || "free");
  const planBadge = (account?.plan || "free").toUpperCase();
  const orig = accountSlots(account?.profile[field] || "", limit);
  const [slots, setSlots] = useState<string[]>(orig);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  // cooldown null = NOT loaded → FAIL CLOSED (saved slots stay locked). openedAt = server
  // ms the 5-min self-service window opened.
  const [cooldown, setCooldown] = useState<SlotCooldowns | null>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [, setTick] = useState(0); // 1s re-render for the live countdowns (no re-poll)

  useEffect(() => { setSlots(accountSlots(account?.profile[field] || "", limit)); setState("idle"); setErr(""); }, [account, limit, field]);

  // Read server-authoritative cooldowns once on mount / account change (admins skip).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let active = true;
    setCooldown(null); setOpenedAt(null);
    if (isAdmin) return;
    void fetchSlotCooldowns().then((cd) => {
      if (!active || !cd) return;               // error/no-supabase → stay fail-closed
      setCooldown(cd);
      setOpenedAt(Date.now() + cd.offsetMs);     // window opens now (server-anchored)
    });
    return () => { active = false; };
  }, [account, isAdmin]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isAdmin || !cooldown) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isAdmin, cooldown]);

  // Server-anchored "now" for the LIVE countdowns; the LOCK decision uses this, never
  // the raw device clock alone.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = () => Date.now() + (cooldown?.offsetMs ?? 0);
  const windowLeftMs = () => (openedAt == null ? 0 : WINDOW_MS - (serverNow() - openedAt));

  const savedSlotView = (i: number): SavedSlotView => {
    if (isAdmin) return { editable: true, note: "window", unlockMs: 0 };
    if (!cooldown) return { editable: false, note: "telegram", unlockMs: 0 };
    const last = cooldown.byKey.get(slotKey(field, i)) ?? null;
    const st = slotLockState(last, serverNow());
    if (st.status === "cooling") return { editable: false, note: "cooling", unlockMs: (st.unlockAtMs ?? 0) - serverNow() };
    return windowLeftMs() > 0 ? { editable: true, note: "window", unlockMs: 0 } : { editable: false, note: "telegram", unlockMs: 0 };
  };
  const savedSlotEditable = (i: number): boolean => savedSlotView(i).editable;

  // Combined cap across BOTH platforms (this platform's drafts + the other's saved).
  const otherCount = accountList(account?.profile[other] || "").length;
  const atCap = otherCount + accountList(slots.join("\n")).length >= limit;
  const setSlot = (i: number, v: string) => { setSlots((s) => s.map((x, idx) => (idx === i ? v : x))); setState("idle"); };
  // Save shows when there is any empty slot OR any cooldown-unlocked saved slot.
  const hasEditable = slots.some((_, i) => (orig[i] ? savedSlotEditable(i) : true));

  const save = async () => {
    if (!onSaveChannels || state === "saving") return;
    setState("saving"); setErr("");
    const changedUnlocked: number[] = [];
    if (!isAdmin) {
      for (let i = 0; i < slots.length; i++) if (orig[i] && savedSlotEditable(i) && slots[i].trim() !== orig[i].trim()) changedUnlocked.push(i);
    }
    // The server is the REAL gate: record each change first. A race (<4h) →
    // 'cooldown_active' → abort WITHOUT persisting (no silent partial save).
    for (const i of changedUnlocked) {
      const r = await touchSlot(field, i);
      if (!r.ok) { setState("error"); setErr(r.cooldown ? t.rd_ch_cooldown_err : (r.error || t.rd_set_err_save_failed)); return; }
    }
    const lists = isTT
      ? { tiktok: accountText(slots), facebook: account?.profile.facebook || "" }
      : { tiktok: account?.profile.tiktok || "", facebook: accountText(slots) };
    const unlocked = isTT ? { tiktok: changedUnlocked } : { facebook: changedUnlocked };
    const r = await onSaveChannels(lists, { unlocked });
    if (r.ok) setState("saved"); else { setState("error"); setErr(r.error || t.rd_set_err_save_failed); }
  };

  return { isTT, isAdmin, limit, planBadge, orig, slots, setSlot, savedSlotView, savedSlotEditable, atCap, hasEditable, save, state, err, windowLeftMs };
}
