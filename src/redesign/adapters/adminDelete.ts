// Phase 2 client adapter for the admin-delete-user edge function (FULL WIPE).
// Replaces the old accountDb.deleteUser() (which only removed the profile row).
// The real delete — auth account + all data incl. billing orders — happens
// server-side in the edge function; this only invokes it and surfaces the result.
import { supabase } from "../../supabase";

export interface HardDeleteResult {
  ok: boolean;
  error?: string;
  code?: string;
  deleted?: Record<string, unknown>;
}

// PURE typed-confirmation for the irreversible-wipe dialog: the admin must type
// the target's EXACT email (trimmed, case-insensitive) to arm the delete. Unit-tested.
export function confirmEmailMatches(typed: string, targetEmail: string): boolean {
  const n = (s: string) => String(s ?? "").trim().toLowerCase();
  return n(typed).length > 0 && n(typed) === n(targetEmail);
}

// Hard-delete ONE seller via the edge function. The server re-checks admin +
// the self/admin-master guards; a normal seller replaying this gets 403/400.
export async function hardDeleteUser(email: string): Promise<HardDeleteResult> {
  if (!supabase) return { ok: false, error: "Delete service unavailable" };
  try {
    const { data, error } = await supabase.functions.invoke("admin-delete-user", {
      body: { mode: "user", email: email.trim().toLowerCase() },
    });
    const r = data as { success?: boolean; error?: string; code?: string; deleted?: Record<string, unknown> } | null;
    if (error || !r?.success) return { ok: false, error: r?.error || error?.message || "Delete failed", code: r?.code };
    return { ok: true, deleted: r.deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Edge function call failed" };
  }
}

// SELF-SERVICE full wipe: a seller deletes THEIR OWN account via the same edge
// function (mode "self" — no admin gate, but the server blocks admin/master
// self-deletes). Replaces the old client deleteUser() which Phase 1's admin-only
// DELETE policy now rejects. The caller is derived from the JWT server-side, so
// no email is sent (a seller can only ever wipe themselves).
export async function selfDeleteAccount(): Promise<HardDeleteResult> {
  if (!supabase) return { ok: false, error: "Delete service unavailable" };
  try {
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { mode: "self" } });
    const r = data as { success?: boolean; error?: string; code?: string; deleted?: Record<string, unknown> } | null;
    if (error || !r?.success) return { ok: false, error: r?.error || error?.message || "Delete failed", code: r?.code };
    return { ok: true, deleted: r.deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Edge function call failed" };
  }
}

// Ghost cleanup (admin-triggered). "ghost-scan" = DRY RUN (list only, no delete);
// "ghost-purge" = wipe every profile-less auth account. Returns the raw payload.
export async function ghostCleanup(mode: "ghost-scan" | "ghost-purge"): Promise<{
  ok: boolean; error?: string; count?: number; purged?: number; ghosts?: unknown[]; detail?: unknown[];
}> {
  if (!supabase) return { ok: false, error: "Delete service unavailable" };
  try {
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { mode } });
    const r = data as { success?: boolean; error?: string; count?: number; purged?: number; ghosts?: unknown[]; detail?: unknown[] } | null;
    if (error || !r?.success) return { ok: false, error: r?.error || error?.message || "Ghost cleanup failed" };
    return { ok: true, count: r.count, purged: r.purged, ghosts: r.ghosts, detail: r.detail };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Edge function call failed" };
  }
}
