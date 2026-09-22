// Shared Channels editor logic — the SINGLE source of the plan-capped, 4h-cooldown
// account save. Consumed by the full-screen ManageChannels AND the compact manage-mode
// LiveConnectModal (no forked security path). Behavior is identical in both; only the
// RENDER differs. Guarded by the ManageChannels + cooldown test suites.
//
// LOCKED-AGAD model (2026-09-23): saved handles are LOCKED on open. Editing a saved
// handle is a DELIBERATE two-step: tap "Change" (unlock this slot, client-side) → edit →
// Save. "Change" is offered ONLY for a slot that is not cooling (≥4h since its last
// change / never changed) once the cooldown is loaded; admins are always editable.
//
// ⚠️ ANTI-ABUSE: "Change" is a UI reveal ONLY. The real 4h gate is server-side —
// save() calls touchSlot(field,i) for every changed saved slot and the server RAISES
// 'cooldown_active' (<4h, non-admin) → save aborts, NOTHING persisted. A tampered client
// that force-unlocks a cooling slot still cannot rotate: the server is the gate. Account
// writes go through onSaveChannels → composeChannelSave (keepLockedAccounts +
// fitProfileAccounts + admin bypass); this hook never writes accounts directly.
import { useEffect, useState } from "react";
import { accountSlots, accountList, accountText, maxAcc } from "./connect";
import { fetchSlotCooldowns, touchSlot, slotLockState, slotKey, type SlotCooldowns } from "./tiktokCooldown";
import { isAdminRole } from "../../lib/roles";
import type { AccountUser } from "../../accountDb";
import { useT } from "../i18n";

// note: "cooling" = locked with an "Unlock in Xh Ym" countdown (<4h); "locked" = locked,
// show a "Change" button when canChange (≥4h / never changed, cooldown loaded), else a
// bare 🔒 (admin-bypassed OR fail-closed); "unlocked" = editable input now.
export type SavedSlotView = { editable: boolean; note: "cooling" | "locked" | "unlocked"; unlockMs: number; canChange: boolean };
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
  // cooldown null = NOT loaded → FAIL CLOSED (saved slots stay locked, no Change).
  const [cooldown, setCooldown] = useState<SlotCooldowns | null>(null);
  // Slots the seller deliberately tapped "Change" on this session (client-side reveal).
  const [unlockedSlots, setUnlockedSlots] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0); // 1s re-render for the live "Unlock in Xh Ym" countdown

  useEffect(() => {
    setSlots(accountSlots(account?.profile[field] || "", limit));
    setUnlockedSlots(new Set()); setState("idle"); setErr("");
  }, [account, limit, field]);

  // Read server-authoritative cooldowns once on mount / account change (admins skip).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let active = true;
    setCooldown(null);
    if (isAdmin) return;
    void fetchSlotCooldowns().then((cd) => {
      if (!active || !cd) return;               // error/no-supabase → stay fail-closed
      setCooldown(cd);
    });
    return () => { active = false; };
  }, [account, isAdmin]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isAdmin || !cooldown) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isAdmin, cooldown]);

  // Server-anchored "now" (offset captured at fetch); the LOCK decision never uses the
  // raw device clock alone. eslint-disable-next-line react-hooks/purity
  // eslint-disable-next-line react-hooks/purity
  const serverNow = () => Date.now() + (cooldown?.offsetMs ?? 0);

  // Per SAVED slot i (orig[i] truthy): admin → editable; no cooldown loaded → fail-closed
  // LOCKED (no Change); cooling (<4h) → LOCKED + "Unlock in Xh"; else changeable → LOCKED
  // with a "Change" button until the seller taps it (then editable). Server-time only.
  const savedSlotView = (i: number): SavedSlotView => {
    if (isAdmin) return { editable: true, note: "unlocked", unlockMs: 0, canChange: false };
    if (!cooldown) return { editable: false, note: "locked", unlockMs: 0, canChange: false }; // fail-closed
    const last = cooldown.byKey.get(slotKey(field, i)) ?? null;
    const st = slotLockState(last, serverNow());
    if (st.status === "cooling") return { editable: false, note: "cooling", unlockMs: (st.unlockAtMs ?? 0) - serverNow(), canChange: false };
    if (unlockedSlots.has(i)) return { editable: true, note: "unlocked", unlockMs: 0, canChange: false };
    return { editable: false, note: "locked", unlockMs: 0, canChange: true }; // 🔒 + Change
  };

  // Deliberate unlock of ONE slot (the "Change" tap). No-op unless the slot is changeable
  // (never a cooling / admin / fail-closed slot). The server still gates the save.
  const unlock = (i: number) => { if (savedSlotView(i).canChange) setUnlockedSlots((s) => new Set(s).add(i)); };

  // Combined cap across BOTH platforms (this platform's drafts + the other's saved).
  const otherCount = accountList(account?.profile[other] || "").length;
  const atCap = otherCount + accountList(slots.join("\n")).length >= limit;
  const setSlot = (i: number, v: string) => { setSlots((s) => s.map((x, idx) => (idx === i ? v : x))); setState("idle"); };

  // There is a pending, saveable change: an add to an empty slot, or a changed value in an
  // editable (admin / unlocked) saved slot. Drives the Save button.
  const dirty = slots.some((v, i) => {
    const now = (v || "").trim(); const was = (orig[i] || "").trim();
    if (now === was) return false;
    if (isAdmin || !orig[i]) return true;      // admin, or an add to an empty slot
    return savedSlotView(i).editable;           // a changed unlocked saved slot
  });

  const save = async () => {
    if (!onSaveChannels || state === "saving") return;
    setState("saving"); setErr("");
    // SAVED slots the seller changed under a deliberate unlock (adds are NOT touched —
    // a fresh add is not a rotation; only overwriting an existing saved handle is).
    const changed: number[] = [];
    if (!isAdmin) {
      for (let i = 0; i < slots.length; i++) if (orig[i] && savedSlotView(i).editable && slots[i].trim() !== orig[i].trim()) changed.push(i);
    }
    // The server is the REAL gate: record each change first. A race (<4h) →
    // 'cooldown_active' → abort WITHOUT persisting (no silent partial save).
    for (const i of changed) {
      const r = await touchSlot(field, i);
      if (!r.ok) { setState("error"); setErr(r.cooldown ? t.rd_ch_cooldown_err : (r.error || t.rd_set_err_save_failed)); return; }
    }
    const lists = isTT
      ? { tiktok: accountText(slots), facebook: account?.profile.facebook || "" }
      : { tiktok: account?.profile.tiktok || "", facebook: accountText(slots) };
    const unlocked = isTT ? { tiktok: changed } : { facebook: changed };
    const r = await onSaveChannels(lists, { unlocked });
    if (r.ok) setState("saved"); else { setState("error"); setErr(r.error || t.rd_set_err_save_failed); }
  };

  return { isTT, isAdmin, limit, planBadge, orig, slots, setSlot, savedSlotView, unlock, atCap, dirty, save, state, err };
}
