// COMMENT PERSISTENCE (Chotdon-parity session history) — final spec 2026-07-11.
// Save the accepted live feed to Supabase in batched blobs; on app open, restore
// the current session-window's newest ≤500 comments as a SEPARATE, display-only
// array. Storage schema + RPC + purge cron: sql/17_session_comments.sql.
//
// ⚠️ DUPLICATE-ORDER SAFETY (the cancelled-F4 lesson — audit-verified, 3 layers):
//   1. Restored comments NEVER enter useLiveFeed (no socket handler, no
//      pushComment) → the onComment Auto-Mode seam is structurally unreachable.
//   2. They never reach feedRef → getComment(restoredId) === undefined → the
//      1-Click / Enterprise handlers hard-return before createOrder.
//   3. Restored rows render muted with NO action row (Dashboard.tsx branch,
//      test-pinned: zero <button> elements on a restored row).
// This module therefore imports NOTHING from the order hub — only the exported
// commentKey/toRedesignComment/isPreviewEnv from useLiveFeed (tangled zones
// untouched).
//
// ⚠️ ZERO TAIL LOSS (Jeff hard requirement — the LATEST comments are the ones
// that matter): every accepted comment is mirrored SYNCHRONOUSLY to
// localStorage the moment it lands (no batching delay on the mirror). Server
// flushes are batched (≥100 comments or 60s); the exit flush fires on
// visibilitychange→hidden (page still alive — the reliable WKWebView event)
// with pagehide as a deduped secondary; and any comments the server never
// confirmed are RESENT on the next app open from the mirror. Kill paths that
// fire no JS event (iOS swipe-kill / OS kill — WebKit 199854) are covered by
// the mirror+resend loop, not by any exit event. Duplicate rows from resend /
// dual-device are tolerated in storage and collapsed at read by commentKey.
//
// EGRESS: writes = one small insert per ≤60s while comments flow (return=
// minimal); reads = ONE RPC per app open returning EXACTLY ≤500 tuples
// (server-side cap — audit F1). ZERO poll anywhere.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import type { Comment as RDComment } from "../data";
import { commentKey, isPreviewEnv, toRedesignComment } from "./useLiveFeed";

// ── constants (exported for tests + the SQL contract test) ───────────────────
export const TUPLE_V = 1;
export const BATCH_MAX = 100;          // tuples per DB row — sql/17 mirror
export const RESTORE_CAP = 500;        // client re-cap of the RPC's server cap
export const FLUSH_AT = 100;           // pending size that triggers a flush
export const FLUSH_INTERVAL_MS = 60_000;
export const PENDING_CAP = 1000;       // memory/mirror bound — drop OLDEST first
export const EXIT_FLUSH_MAX = 300;     // newest N in the exit flush (64KiB keepalive quota)
export const EXIT_DEDUPE_MS = 1500;    // hidden + pagehide double-fire guard
export const FAIL_STREAK_MAX = 3;      // then rely on mirror + next-open resend
export const MIRROR_KEY_PREFIX = "sfl_rd_cmirror_v1_"; // + auth user id
const SAVED_KEYS_TRIM = 12_000;

// Direct PostgREST endpoint for the exit flush (supabase-js would await auth
// internally; the exit path must be fully synchronous up to fetch()). Same env
// cleaning as src/supabase.ts; read lazily so tests can stub the env.
const cleanEnv = (v: string | undefined) => (v || "").trim().replace(/^["']|["']$/g, "");
const supaUrl = (): string => cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const supaKey = (): string => cleanEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) || cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);

// Preview gate (audit F10): the preview feed is 100% synthetic (real sockets
// can't connect there), so persistence is OFF on preview unless explicitly
// opted in with ?hist=1 (how googletest preview verification runs).
export const isPersistEnabled = (): boolean => {
  if (!isPreviewEnv()) return true;
  return typeof window !== "undefined" && /[?&]hist=1(&|$)/.test(window.location.search);
};

// ── tuple codec (pure) ────────────────────────────────────────────────────────
// [platform, sourceUsername, sessionId, handle, timestamp, comment, name, isBuy, time]
// Keeps ALL SIX commentKey fields (identity fidelity → overlap dedup) + the
// three display fields. Comment text is NOT truncated — truncation would change
// commentKey and break the live/restored overlap dedup. timestamp sits at
// index 4 — the restore RPC orders by tuple->>4 (sql/17); keep in lockstep.
export type CommentTuple = [string, string, string, string, string, string, string, 0 | 1, string];

export const toTuple = (c: ProdComment): CommentTuple => [
  c.platform === "Facebook" ? "Facebook" : "TikTok",
  c.sourceUsername || "",
  c.sessionId || "",
  c.handle || "",
  c.timestamp || "",
  c.comment || "",
  c.name || "",
  c.isBuy ? 1 : 0,
  c.time || "",
];

export const fromTuple = (t: unknown): ProdComment | null => {
  if (!Array.isArray(t) || t.length < 9) return null;
  const s = (i: number): string => (typeof t[i] === "string" ? (t[i] as string) : "");
  const handle = s(3).trim();
  const comment = s(5);
  if (!handle || !comment) return null; // same acceptance floor as the socket handler
  return {
    platform: s(0) === "Facebook" ? "Facebook" : "TikTok",
    sourceUsername: s(1) || undefined,
    sessionId: s(2) || undefined,
    handle,
    timestamp: s(4) || undefined,
    comment,
    name: s(6) || handle,
    isBuy: t[7] === 1,
    time: s(8),
    buyerNum: null,
    buyerData: null,
  };
};

export const encodeBatch = (list: ProdComment[]): { v: number; t: CommentTuple[] } =>
  ({ v: TUPLE_V, t: list.map(toTuple) });

export const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// RPC payload → validated, deduped, capped, newest-first list. Malformed
// entries are SKIPPED (never a throw, never a blank feed — audit F8/angle 5).
export const decodeRestorePayload = (raw: unknown): ProdComment[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProdComment[] = [];
  for (const t of raw) {
    const c = fromTuple(t);
    if (!c) continue;
    const k = commentKey(c);
    if (seen.has(k)) continue; // dual-device / resend duplicates collapse here
    seen.add(k);
    out.push(c);
    if (out.length >= RESTORE_CAP) break;
  }
  return out;
};

// Display merge — restored rows APPEND below the live block (they are older by
// construction; no global re-sort so the "— Session history —" divider stays a
// clean boundary). Overlap (saved pre-refresh + still newest live) collapses by
// commentKey with the LIVE copy winning. Live structures untouched: this maps
// via the exported toRedesignComment only.
export function mergeForDisplay(live: RDComment[], restored: ProdComment[]): RDComment[] {
  if (!restored.length) return live;
  const liveIds = new Set(live.map((c) => c.id));
  const hist: RDComment[] = [];
  for (const c of restored) {
    const k = commentKey(c);
    if (liveIds.has(k)) continue;
    hist.push({ ...toRedesignComment(c), restored: true });
  }
  return hist.length ? [...live, ...hist] : live;
}

// ── local mirror (zero-tail-loss layer; localStorage = SYNCHRONOUS commit) ───
// localStorage over IndexedDB, deliberately: the mirror's whole job is "the
// bytes are on disk BEFORE the kill" — an async IndexedDB transaction can lose
// the very comment that arrived in the kill instant, while setItem commits
// synchronously. Payload is small (≤PENDING_CAP tuples), and localStorage is
// the codebase-wide precedent. Keyed per auth uid so a shared device never
// clobbers another seller's unconfirmed tail.
interface MirrorShape { v: number; win: string; t: unknown[] }

const mirrorKey = (uid: string): string => MIRROR_KEY_PREFIX + uid;

export const readMirror = (uid: string): { win: string; comments: ProdComment[] } | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(mirrorKey(uid));
    if (!raw) return null;
    const m = JSON.parse(raw) as MirrorShape;
    if (!m || m.v !== TUPLE_V || typeof m.win !== "string" || !Array.isArray(m.t)) {
      localStorage.removeItem(mirrorKey(uid));
      return null;
    }
    return { win: m.win, comments: m.t.map(fromTuple).filter((c): c is ProdComment => !!c) };
  } catch {
    try { localStorage.removeItem(mirrorKey(uid)); } catch { /* ignore */ }
    return null;
  }
};

export const writeMirror = (uid: string | null, win: string, list: ProdComment[]): void => {
  if (!uid || typeof localStorage === "undefined") return;
  const put = (l: ProdComment[]) =>
    localStorage.setItem(mirrorKey(uid), JSON.stringify({ v: TUPLE_V, win, t: l.map(toTuple) }));
  try {
    if (!list.length) { localStorage.removeItem(mirrorKey(uid)); return; }
    put(list);
  } catch {
    // quota — keep the NEWEST half (Jeff: latest comments matter most)
    try { put(list.slice(-Math.floor(list.length / 2))); } catch { /* server flushes still run */ }
  }
};

export const clearMirror = (uid: string | null): void => {
  if (!uid || typeof localStorage === "undefined") return;
  try { localStorage.removeItem(mirrorKey(uid)); } catch { /* ignore */ }
};

// ── the hook ──────────────────────────────────────────────────────────────────
export interface UseCommentHistory { restored: ProdComment[] }

export function useCommentHistory(
  enabled: boolean,             // authed && session-window config loaded
  email: string | undefined,
  windowKey: string,            // sessionKeyFor(...) — SAME machinery as shipping
  rawFeed: ProdComment[],       // useLiveFeed's post-dedup feed state (read-only)
): UseCommentHistory {
  const [restored, setRestored] = useState<ProdComment[]>([]);
  const uidRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);      // sync-cached for the exit path (audit F4)
  const savedKeysRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<ProdComment[]>([]);      // arrival order (oldest → newest)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const failStreakRef = useRef(0);
  const exitFlushAtRef = useRef(0);
  const restoredForRef = useRef<string | null>(null); // one-shot restore per seller (audit F12)
  const restoredWinRef = useRef<string | null>(null);
  const winKeyRef = useRef(windowKey);

  // Confirmed-by-server comments leave pending + mirror. Filter by key (new
  // comments may have arrived during the network await).
  const confirmFlushed = useCallback((sent: ProdComment[]) => {
    const sentKeys = new Set(sent.map(commentKey));
    pendingRef.current = pendingRef.current.filter((c) => !sentKeys.has(commentKey(c)));
    writeMirror(uidRef.current, winKeyRef.current, pendingRef.current);
  }, []);

  const buildRows = useCallback((list: ProdComment[]) => {
    const uid = uidRef.current as string;
    return chunk(list, BATCH_MAX).map((l) => ({
      user_id: uid,
      session_key: winKeyRef.current,
      comments: encodeBatch(l),
      comment_count: l.length,
    }));
  }, []);

  // Normal flush — supabase-js insert (auto token refresh, no .select() →
  // return=minimal → ~zero response egress). Fire-and-forget: the live feed is
  // NEVER affected by a failed save; after FAIL_STREAK_MAX misses we stop
  // burning network and let the mirror + next-open resend carry the data.
  const flush = useCallback(async (): Promise<void> => {
    if (!supabase || !uidRef.current || flushingRef.current) return;
    if (failStreakRef.current >= FAIL_STREAK_MAX) return;
    const toSend = pendingRef.current;
    if (!toSend.length) return;
    flushingRef.current = true;
    try {
      const { error } = await supabase.from("session_comment_batches").insert(buildRows(toSend));
      if (error) throw error;
      confirmFlushed(toSend);
      failStreakRef.current = 0;
    } catch (e) {
      failStreakRef.current += 1;
      if (failStreakRef.current === 1) console.warn("comment-history save failed (mirror + resend-on-open will cover)", e);
    } finally {
      flushingRef.current = false;
    }
  }, [buildRows, confirmFlushed]);

  // Exit flush — visibilitychange→hidden (primary: the page is STILL ALIVE
  // there, the only reliable WKWebView exit signal) + pagehide (secondary for
  // the refresh path, deduped). Raw fetch: cached token (NO async getSession on
  // a dying page), keepalive:true as free insurance, body capped to the newest
  // EXIT_FLUSH_MAX comments (64KiB shared keepalive quota). Confirmation only
  // on a real 2xx — if the process dies first, the mirror resends next open.
  const exitFlush = useCallback(() => {
    const uid = uidRef.current, token = tokenRef.current;
    const url = supaUrl(), key = supaKey();
    if (!uid || !token || !url || !key) return;
    if (!pendingRef.current.length) return;
    const now = Date.now();
    if (now - exitFlushAtRef.current < EXIT_DEDUPE_MS) return;
    exitFlushAtRef.current = now;
    const toSend = pendingRef.current.slice(-EXIT_FLUSH_MAX); // newest first in priority
    try {
      void fetch(`${url}/rest/v1/session_comment_batches`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(buildRows(toSend)),
      }).then((r) => { if (r.ok) confirmFlushed(toSend); }).catch(() => { /* mirror covers it */ });
    } catch { /* mirror covers it */ }
  }, [buildRows, confirmFlushed]);

  // Track the live window key for flush-time tagging; on a window rollover
  // (midnight reset / N-switch) drop the OLD window's restored block from the
  // display (audit F9) — the fresh window starts clean, like the session does.
  useEffect(() => {
    winKeyRef.current = windowKey;
    if (restoredWinRef.current !== null && restoredWinRef.current !== windowKey) {
      restoredWinRef.current = windowKey;
      setRestored([]);
    }
  }, [windowKey]);

  // Auth identity + sync token cache (kept fresh by the auth listener so the
  // exit path never awaits). Values persist through sign-out so a logout-tab
  // exit flush can still deliver.
  useEffect(() => {
    if (!enabled || !email || !supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.user?.id) uidRef.current = data.session.user.id;
      if (data.session?.access_token) tokenRef.current = data.session.access_token;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user?.id) uidRef.current = session.user.id;
      if (session?.access_token) tokenRef.current = session.access_token;
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [enabled, email]);

  // ONE-SHOT restore per signed-in seller (audit F12): resend the unconfirmed
  // mirror first (zero-tail-loss close of the kill paths), THEN one capped RPC
  // read — so the just-resent tail is part of the restored history. ZERO POLL:
  // this is the feature's only read.
  useEffect(() => {
    if (!enabled || !email || !windowKey || !supabase) return;
    if (restoredForRef.current === email) return;
    restoredForRef.current = email;
    restoredWinRef.current = windowKey;
    const sb = supabase;
    let active = true;
    void (async () => {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return;
      uidRef.current = uid;
      if (data.session?.access_token) tokenRef.current = data.session.access_token;
      // 1) resend-on-open (idempotency = commentKey dedup at read time)
      const mirror = readMirror(uid);
      if (mirror) {
        if (mirror.win !== windowKey) {
          clearMirror(uid); // closed window — its rows are purge-bound anyway
        } else if (mirror.comments.length) {
          try {
            const { error } = await sb.from("session_comment_batches").insert(
              chunk(mirror.comments, BATCH_MAX).map((l) => ({
                user_id: uid, session_key: windowKey, comments: encodeBatch(l), comment_count: l.length,
              })),
            );
            if (error) throw error;
            clearMirror(uid);
          } catch {
            // keep the mirror AND queue the tail for the live flush cycle
            mirror.comments.forEach((c) => savedKeysRef.current.add(commentKey(c)));
            pendingRef.current = [...mirror.comments, ...pendingRef.current].slice(-PENDING_CAP);
          }
        }
      }
      // 2) the one capped read (server-enforced ≤500 — audit F1)
      const { data: raw, error } = await sb.rpc("session_comments_restore", { p_session_key: windowKey });
      if (!active) return;
      if (error) { console.warn("comment-history restore failed (feed starts empty, live unaffected)", error); return; }
      setRestored(decodeRestorePayload(raw));
    })();
    return () => { active = false; };
  }, [enabled, email, windowKey]);

  // SAVE — subscribes to the post-dedup feed STATE (strictly after commentKey/
  // dedup/sort/cap, outside the socket handler — tangled zone #1 untouched).
  // Every fresh comment is mirrored SYNCHRONOUSLY in this same effect tick
  // (zero-tail-loss), then batched toward the server (≥FLUSH_AT or 60s).
  useEffect(() => {
    // rawFeed is optional-chained: test harnesses that mock useLiveFeed without
    // the (additive) rawFeed field must degrade to "nothing to save", not throw.
    if (!enabled || !rawFeed?.length || !isPersistEnabled()) return;
    const fresh = rawFeed.filter((c) => !savedKeysRef.current.has(commentKey(c)));
    if (!fresh.length) return;
    for (const c of fresh) savedKeysRef.current.add(commentKey(c));
    if (savedKeysRef.current.size > SAVED_KEYS_TRIM) {
      // feed is capped at 5,000 and comments never re-arrive (no replay) — a
      // set rebuilt from live feed + pending keeps dedup exact at bounded size.
      savedKeysRef.current = new Set([...rawFeed, ...pendingRef.current].map(commentKey));
    }
    // feed is newest-first → append reversed to keep pending in arrival order
    pendingRef.current = [...pendingRef.current, ...[...fresh].reverse()].slice(-PENDING_CAP);
    writeMirror(uidRef.current, winKeyRef.current, pendingRef.current); // ⚠️ the guarantee — synchronous
    if (pendingRef.current.length >= FLUSH_AT) {
      void flush();
    } else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => { flushTimerRef.current = null; void flush(); }, FLUSH_INTERVAL_MS);
    }
  }, [rawFeed, enabled, flush]);

  // Exit listeners + teardown flush attempt.
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onVis = () => { if (document.visibilityState === "hidden") exitFlush(); };
    const onPageHide = () => exitFlush();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      void flush(); // logout/unmount — best-effort; mirror survives regardless
    };
  }, [enabled, exitFlush, flush]);

  return { restored };
}
