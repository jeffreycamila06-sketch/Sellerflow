// Announcements — admin writes one message, ALL sellers see a dismissible
// banner + a 🔔 bell history. Mirrors the useRaffleConfig pattern: ONE read of
// the latest 10 rows on mount, ZERO polling (egress rule). Dismiss (banner) and
// last-seen (bell red dot) are localStorage-only — per device, no seller writes.
// Publish/unpublish are admin-only writes enforced by the RLS is_admin()
// policies on the announcements table (a non-admin call just errors — there is
// no client-side-only gate to bypass).
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface Announcement {
  id: string;
  message: string;
  active: boolean;
  createdAt: string; // ISO
}

export const ANN_LS_DISMISSED = "sfl_rd_ann_dismissed";
export const ANN_LS_LAST_SEEN = "sfl_rd_ann_last_seen";
const lsGet = (k: string): string => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// Newest ACTIVE announcement (list arrives newest-first) — the banner source.
export const pickLatestActive = (list: Announcement[]): Announcement | null =>
  list.find((a) => a.active) || null;

// Bell red dot: the newest announcement (active or not) hasn't been seen yet.
export const hasUnread = (list: Announcement[], lastSeenId: string): boolean =>
  list.length > 0 && list[0].id !== lastSeenId;

export interface UseAnnouncements {
  list: Announcement[];            // latest 10, newest first
  latest: Announcement | null;     // newest active → banner
  loading: boolean;
  dismissedId: string;             // banner hidden when latest.id === dismissedId
  dismiss: (id: string) => void;   // "Got it" → persist + hide (new id shows again)
  lastSeenId: string;
  markSeen: (id: string) => void;  // bell list opened → red dot off
  unread: boolean;
  refresh: () => Promise<void>;
  publish: (message: string) => Promise<{ ok: boolean; error?: string }>;
  unpublish: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useAnnouncements(enabled: boolean): UseAnnouncements {
  const [list, setList] = useState<Announcement[]>([]);
  // Starts true only when a fetch will actually run — every setState in load()
  // then happens AFTER the await (no sync setState inside the mount effect).
  const [loading, setLoading] = useState<boolean>(() => enabled && isSupabaseConfigured && !!supabase);
  const [dismissedId, setDismissedId] = useState<string>(() => lsGet(ANN_LS_DISMISSED));
  const [lastSeenId, setLastSeenId] = useState<string>(() => lsGet(ANN_LS_LAST_SEEN));

  const load = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from("announcements")
      .select("id,message,active,created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error && data) {
      setList(data.map((r) => ({
        id: String(r.id),
        message: String(r.message ?? ""),
        active: !!r.active,
        createdAt: String(r.created_at ?? ""),
      })));
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => { void load(); }, [load]); // READ-ON-LOAD ONLY — no interval/poll

  const dismiss = useCallback((id: string) => { lsSet(ANN_LS_DISMISSED, id); setDismissedId(id); }, []);
  const markSeen = useCallback((id: string) => { lsSet(ANN_LS_LAST_SEEN, id); setLastSeenId(id); }, []);

  // Admin publish: deactivate the current active row, then insert the new one —
  // keeps exactly one active. Both statements pass through the is_admin() RLS.
  const publish = useCallback(async (message: string): Promise<{ ok: boolean; error?: string }> => {
    const msg = message.trim();
    if (!msg) return { ok: false, error: "empty" };
    if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
    const { data: sess } = await supabase.auth.getSession(); // local, no network
    const off = await supabase.from("announcements").update({ active: false }).eq("active", true);
    if (off.error) return { ok: false, error: off.error.message };
    const ins = await supabase.from("announcements").insert({ message: msg, created_by: sess.session?.user?.id ?? null });
    if (ins.error) return { ok: false, error: ins.error.message };
    await load();
    return { ok: true };
  }, [load]);

  const unpublish = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
    const { error } = await supabase.from("announcements").update({ active: false }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await load();
    return { ok: true };
  }, [load]);

  return {
    list,
    latest: pickLatestActive(list),
    loading,
    dismissedId,
    dismiss,
    lastSeenId,
    markSeen,
    unread: hasUnread(list, lastSeenId),
    refresh: load,
    publish,
    unpublish,
  };
}
