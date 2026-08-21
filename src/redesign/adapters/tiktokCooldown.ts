// Self-service TikTok/Facebook username cooldown (client half). The 4-hour gate is
// SERVER-authoritative (sql/24 touch_tiktok_slot REFUSES 'cooldown_active'); this
// adapter only READS the server state to drive the UI and calls touch on a change.
//
// ⚠️ SERVER-TIME ONLY for the lock decision. tiktok_slot_cooldowns() returns the DB
// clock (server_now) alongside each slot's last_changed_at. We compute the offset
// (server_now − Date.now()) ONCE and thereafter treat (Date.now() + offset) as "server
// now" so the countdown ticks without re-polling — the raw device clock never decides a
// lock. A slot with NO row needs no time math (it is unlocked regardless of clock), so
// an empty result set is still a SUCCESSFUL load (offset irrelevant there); only an
// actual RPC error is fail-closed (null → the caller keeps saved slots LOCKED).
import { supabase, isSupabaseConfigured } from "../../supabase";

export const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours — mirror of sql/24 interval '4 hours'
export const WINDOW_MS = 5 * 60 * 1000;         // 5-minute self-service editing window (owner decision B)

export type SlotStatus = "unlocked" | "cooling";

// PURE — the per-slot lock decision from server time. No row OR ≥4h since the last
// change → unlocked; otherwise cooling until lastChangedAt + 4h. unlockAtMs is the
// server instant the cooldown ends (null when already unlocked). Unit-tested.
export function slotLockState(lastChangedAtMs: number | null, serverNowMs: number): { status: SlotStatus; unlockAtMs: number | null } {
  if (lastChangedAtMs == null) return { status: "unlocked", unlockAtMs: null };
  const unlockAt = lastChangedAtMs + COOLDOWN_MS;
  return serverNowMs >= unlockAt ? { status: "unlocked", unlockAtMs: null } : { status: "cooling", unlockAtMs: unlockAt };
}

// PURE — "Unlock in {h}h {m}m" parts. Minutes are rounded UP so it never shows a
// smaller remaining time than real (and never "0h 0m" while still cooling). Unit-tested.
export function unlockInHM(remainingMs: number): { h: number; m: number } {
  const mins = Math.max(0, Math.ceil(remainingMs / 60000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}

// PURE — the 5-minute window clock as "M:SS" (0-clamped). Unit-tested.
export function windowClock(remainingMs: number): string {
  const s = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const slotKey = (platform: string, slotIndex: number): string => `${platform}:${slotIndex}`;

export interface SlotCooldowns {
  offsetMs: number;                 // server_now − Date.now() at fetch (0 when no rows → irrelevant)
  byKey: Map<string, number>;       // `${platform}:${slot_index}` → last_changed_at (ms)
}

// Read the caller's own slot cooldowns + the server clock. Returns null on
// no-supabase / RPC error (→ caller FAILS CLOSED, keeps saved slots locked). An empty
// result set is a successful load (SlotCooldowns with an empty map).
export async function fetchSlotCooldowns(): Promise<SlotCooldowns | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc("tiktok_slot_cooldowns");
  if (error || !Array.isArray(data)) return null;
  const byKey = new Map<string, number>();
  let offsetMs = 0;
  for (const row of data as Array<{ platform?: string; slot_index?: number; last_changed_at?: string; server_now?: string }>) {
    if (row.server_now) offsetMs = new Date(row.server_now).getTime() - Date.now(); // any row carries the same server_now
    if (row.platform != null && row.slot_index != null && row.last_changed_at) {
      byKey.set(slotKey(row.platform, Number(row.slot_index)), new Date(row.last_changed_at).getTime());
    }
  }
  return { offsetMs, byKey };
}

export interface TouchResult { ok: boolean; cooldown?: boolean; error?: string }

// Record a change at server now(). The server REFUSES 'cooldown_active' (<4h, non-admin)
// — surfaced as { ok:false, cooldown:true } so the caller shows the error and does NOT
// persist. Any other failure → { ok:false }. Success → { ok:true }.
export async function touchSlot(platform: "tiktok" | "facebook", slotIndex: number): Promise<TouchResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("touch_tiktok_slot", { p_platform: platform, p_slot_index: slotIndex });
  if (!error) return { ok: true };
  const cooldown = /cooldown_active/i.test(error.message || "");
  return { ok: false, cooldown, error: error.message };
}
