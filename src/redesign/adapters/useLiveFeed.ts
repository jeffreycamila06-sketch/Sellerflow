// Phase 5d — LIVE COMMENT FEED adapter. Reuses the EXACT production socket.io
// setup (same SERVER URL, same event names, same room-join) and the EXACT
// commentKey dedup formula. Imports the shared supabase singleton for the auth
// token. Does NOT touch App.tsx / socket event names / the server / lib/*.
//
// Tangled zones handled here:
//   • #1 commentKey dedup — copied VERBATIM from App.tsx:111-114 and guarded by
//     a parity test (useLiveFeed.test.ts). If App.tsx ever changes the formula,
//     the parity test must be updated in lockstep — they can never silently drift.
//   • #3 feed scroll — the Dashboard owns feedRef + a useLayoutEffect; this hook
//     only produces the newest-first list.
//
// READ-ONLY: receives comments, dedups, caps. NO order writes (that is 5e).
//
// ⚠️ PREVIEW (F2): the Vercel preview cannot TikTok-connect (Render
// CLIENT_ORIGIN=sellerflowlive.com), so a real socket yields no comments there.
// `injectSynthetic()` pushes a test comment through the SAME dedup pipeline so the
// feed/dedup/scroll can be verified without a real socket. It is gated to
// non-production hosts via isPreviewEnv() so real users never see it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { supabase } from "../../supabase";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import type { Comment as RDComment } from "../data";
import { cleanLiveAccount, connectPlatform, type Platform, type ConnectResult } from "./connect";
// Batch E (#13): server URL + seller/browser identity now come from the ONE
// shared module (was a local copy identical to connect.ts's — parity-tested;
// do NOT change names/URLs/storage key).
import { SERVER, sellerIdOf, browserSessionId } from "./serverIdentity";

const LIVE_COMMENT_LIMIT = 5000;
// Fix B — max random delay before an auto re-POST of /connect after a socket drop /
// server restart. 0–25s spread for fast recovery; the server-side MIN_GAP ≤6/min hard cap
// is the actual storm guard, so a tighter window stays safe even with a fleet reconnect.
const AUTO_RECONNECT_JITTER_MS = 25 * 1000;
// STATUS-TRUTH (connection-status fix, exported for tests) — the green pill is a
// PROMISE ("I am capturing your orders right now"), so it must track stream truth:
//   • RECONNECT_GRACE_MS: a server health-cycle reconnect (chat-stale/silent) emits
//     reconnecting:true then usually recovers in 10–45s. Keep the pill GREEN through
//     this grace so a SUCCESSFUL self-heal is invisible (zero flapping — symptom A);
//     if no connected:true lands within the grace, fall to an HONEST gray.
//   • SOCKET_GRACE_MS: a dead socket cannot deliver comments, so green must not
//     outlive it (symptom B's stale-green enabler) — but socket.io usually recovers
//     a transport blip in 1–2s, so a short grace avoids flapping on blips. On
//     recovery the join_live_room snapshot re-asserts the true state.
export const RECONNECT_GRACE_MS = 60 * 1000;
export const SOCKET_GRACE_MS = 8 * 1000;

// commentKey — COPIED VERBATIM from src/App.tsx:111-114 (tangled-zone #1).
// Parity-guarded by useLiveFeed.test.ts. DO NOT edit independently of App.tsx.
export const commentKey = (c: ProdComment | null | undefined): string => {
  if (!c) return "missing-comment";
  return `${c.platform || "TikTok"}|${c.sourceUsername || ""}|${c.sessionId || ""}|${c.handle || "buyer"}|${c.timestamp || c.time || ""}|${c.comment || ""}`;
};

// Newest-first + dedup, mirroring App.tsx sortCommentsNewest + cleanComments.
const commentMs = (c: ProdComment): number => { const t = Date.parse(c?.timestamp || ""); return Number.isFinite(t) ? t : 0; };
const sortNewest = (list: ProdComment[]): ProdComment[] => [...list].sort((a, b) => commentMs(b) - commentMs(a));
const dedup = (list: ProdComment[]): ProdComment[] => {
  const seen = new Set<string>();
  return list.filter((c) => { const k = commentKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
};

// production Comment → redesign Comment (Dashboard shape).
export const toRedesignComment = (c: ProdComment): RDComment => ({
  id: commentKey(c),
  name: c.name || c.handle,
  handle: c.handle ? (c.handle.startsWith("@") ? c.handle : `@${c.handle}`) : "",
  text: c.comment,
  mine: !!c.isBuy,
  time: c.time || "",
  platform: c.platform, // additive — basket-count identity (handle+platform)
});

// Synthetic injector is shown everywhere EXCEPT the real production domain.
export const isPreviewEnv = (): boolean => {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h !== "www.sellerflowlive.com" && h !== "sellerflowlive.com";
};

const SYNTH: { name: string; handle: string; text: string; platform: "TikTok" | "Facebook"; isBuy: boolean }[] = [
  { name: "Aileen Go", handle: "jojo_tw", text: "mine red lipstick 💄", platform: "TikTok", isBuy: true },
  { name: "Mei Lin", handle: "meidolltw", text: "how much po the tumbler?", platform: "TikTok", isBuy: false },
  { name: "Benny Tan", handle: "bennytw", text: "mine size M white tee", platform: "Facebook", isBuy: true },
  { name: "Cara Yu", handle: "caralivetw", text: "claim skincare set", platform: "TikTok", isBuy: true },
  { name: "Don Sy", handle: "donsytw", text: "get the rose gold watch ✨", platform: "Facebook", isBuy: true },
  { name: "Ella Ng", handle: "ella.ng", text: "avail pa ba yung sneakers?", platform: "TikTok", isBuy: false },
];

export interface ActiveAccounts { TikTok: string; Facebook: string }

export interface UseLiveFeed {
  comments: RDComment[];
  connected: boolean;
  canInject: boolean;
  injectSynthetic: (text?: string) => void;
  getComment: (id: string) => ProdComment | undefined; // 5e — resolve a feed id (commentKey) → raw comment
  // #6 connect — real platform connect + server-driven active-account switching.
  activeAccounts: ActiveAccounts;     // which account is live per platform (from platform_status)
  ttConnected: boolean;               // server says TikTok is connected (not reconnecting)
  fbConnected: boolean;
  // F3 — stream health in doubt (grace window armed): display maps this to the
  // amber "Connecting…" visuals instead of a solid green. Recovering has display
  // precedence over connected; green returns only on a real connected:true.
  ttRecovering: boolean;
  fbRecovering: boolean;
  connect: (platform: Platform, data: Record<string, string>) => Promise<ConnectResult>;
  // Fix B — RedesignApp calls this when the USER manually disconnects a platform, so the
  // auto-reconnect-after-restart logic won't restore an account they turned off on purpose.
  markDisconnected: (platform: Platform) => void;
}

export function useLiveFeed(enabled: boolean, email: string | undefined, onComment?: (c: ProdComment) => void, selected?: ActiveAccounts): UseLiveFeed {
  const [feed, setFeed] = useState<ProdComment[]>([]);
  const [connected, setConnected] = useState(false);
  // Auto Mode seam — held in a ref so a changing handler identity NEVER re-subscribes
  // the socket (the effect deps deliberately exclude onComment). Fired per ACCEPTED
  // comment, after all filters, alongside pushComment. Does NOT touch commentKey/dedup.
  const onCommentRef = useRef(onComment);
  onCommentRef.current = onComment;
  // #6 — active live account per platform + per-platform connected flags. Driven by
  // the server `platform_status` event (App.tsx 4072-4080). These still drive the
  // connected-status indicators; they no longer drive the comment filter.
  const [activeAccounts, setActiveAccounts] = useState<ActiveAccounts>({ TikTok: "", Facebook: "" });
  const [ttConnected, setTtConnected] = useState(false);
  const [fbConnected, setFbConnected] = useState(false);
  // F3 — TRUE while a fall-to-gray grace window is armed (server health-cycle
  // reconnect or socket-down grace): the stream's health is IN DOUBT. Display
  // layer maps this to the existing amber "Connecting…" visuals instead of
  // holding a solid green. Cleared the moment the server re-asserts
  // connected:true, or when the grace expires into an honest gray. DISPLAY
  // SIGNAL ONLY — the grace timers / honest-gray state machine are unchanged.
  const [ttRecovering, setTtRecovering] = useState(false);
  const [fbRecovering, setFbRecovering] = useState(false);
  const activeRef = useRef<ActiveAccounts>(activeAccounts);
  activeRef.current = activeAccounts;
  // Account-leak fix: the comment filter follows the USER's dropdown selection, NOT
  // the server-driven activeAccounts (last-platform_status-wins, drifts when multiple
  // accounts are live). The ref lets the comment handler read the latest selection
  // without re-subscribing the socket. We ALSO tell the server this selection via
  // `select_account` so the wrong account's comments never reach this socket.
  const ttSel = selected?.TikTok || "";
  const fbSel = selected?.Facebook || "";
  const selectedRef = useRef<ActiveAccounts>({ TikTok: ttSel, Facebook: fbSel });
  selectedRef.current = { TikTok: ttSel, Facebook: fbSel };
  const socketRef = useRef<Socket | null>(null);
  // Fix B — auto-reconnect after a socket drop / server restart.
  //   • connectedAcctsRef: the account THIS client genuinely connected per platform (set on
  //     connect success, cleared on user disconnect) → we only ever restore these.
  //   • hasConnectedSocketRef: false until the FIRST socket connect; the first connect must
  //     NOT re-POST (no TikTok connection existed yet) — only RE-connects restore.
  //   • serverConnectedRef: mirror of tt/fbConnected (server truth) → dedupe; skip re-POST
  //     if the server already reports the account live (e.g. a brief drop, not a restart).
  //   • reconnectTimersRef: pending jittered re-POST timers, cleared on teardown.
  const connectedAcctsRef = useRef<{ TikTok: string; Facebook: string }>({ TikTok: "", Facebook: "" });
  const hasConnectedSocketRef = useRef(false);
  const serverConnectedRef = useRef<{ TikTok: boolean; Facebook: boolean }>({ TikTok: false, Facebook: false });
  serverConnectedRef.current = { TikTok: ttConnected, Facebook: fbConnected };
  const reconnectTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // STATUS-TRUTH — pending fall-to-gray timers per platform. A timer is armed when
  // the stream's health is IN DOUBT (server reconnecting / socket dead) and cancelled
  // the moment the server re-asserts connected:true. "Keep earliest deadline": arming
  // while armed is a no-op, so repeated reconnecting/connect_error events can never
  // extend a false green.
  const grayTimersRef = useRef<{ TikTok: ReturnType<typeof setTimeout> | null; Facebook: ReturnType<typeof setTimeout> | null }>({ TikTok: null, Facebook: null });
  const synthIdx = useRef(0);
  // Latest feed readable from a stable getter (for 5e order creation by id).
  const feedRef = useRef<ProdComment[]>(feed);
  feedRef.current = feed;
  const getComment = useCallback((id: string) => feedRef.current.find((c) => commentKey(c) === id), []);

  const pushComment = useCallback((c: ProdComment) => {
    setFeed((prev) => dedup(sortNewest([c, ...prev])).slice(0, LIVE_COMMENT_LIMIT));
  }, []);

  useEffect(() => {
    if (!enabled || !email) return;
    const em = email; // narrowed to string for the closures below
    const sellerId = sellerIdOf(em);
    const sessionId = browserSessionId();
    // New socket subscription (mount or user/email change): the upcoming first connect
    // must be treated as first-connect, and connected-account tracking must not carry
    // across users. (Effect deps are [enabled, email, pushComment]; pushComment is stable.)
    hasConnectedSocketRef.current = false;
    connectedAcctsRef.current = { TikTok: "", Facebook: "" };
    // Fix B — on a RE-connect (socket dropped / server restart), restore the accounts THIS
    // client had connected by re-POSTing /connect, each after a 0–60s random jitter so a
    // fleet-wide reconnect never hits /connect at once. First connect restores nothing.
    const autoReconnectAfterDrop = () => {
      (["TikTok", "Facebook"] as Platform[]).forEach((platform) => {
        const acct = connectedAcctsRef.current[platform];
        if (!acct) return;                                  // only restore genuinely-connected
        if (serverConnectedRef.current[platform]) return;   // dedupe: server still has it live
        const delay = Math.floor(Math.random() * AUTO_RECONNECT_JITTER_MS);
        const timer = setTimeout(() => {
          if (serverConnectedRef.current[platform]) return;          // re-check at fire time
          if (connectedAcctsRef.current[platform] !== acct) return;  // user changed/off during wait
          void connectPlatform(platform, { username: acct }, em).then((r) => { if (r.ok) setFeed([]); }).catch(() => {});
        }, delay);
        reconnectTimersRef.current.push(timer);
      });
    };
    const s: Socket = io(SERVER, {
      path: "/socket.io/",
      transports: ["websocket"],
      auth: (cb: (d: { token: string }) => void) => {
        if (!supabase) { cb({ token: "" }); return; }
        supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token || "" }));
      },
    });
    socketRef.current = s;
    const joinRoom = () => s.emit("join_live_room", { sellerId, sessionId });
    // Tell the server which account this socket is viewing (account-leak fix). Re-sent
    // on every (re)connect so the server's per-socket selection survives reconnects.
    const emitSelection = () => {
      s.emit("select_account", { platform: "TikTok", username: selectedRef.current.TikTok });
      s.emit("select_account", { platform: "Facebook", username: selectedRef.current.Facebook });
    };
    // STATUS-TRUTH helpers (status layer ONLY — comment handler/dedup untouched).
    const setRecovering = (platform: Platform, v: boolean) => {
      if (platform === "TikTok") setTtRecovering(v); else setFbRecovering(v);
    };
    const setPlatformGray = (platform: Platform) => {
      if (platform === "TikTok") setTtConnected(false); else setFbConnected(false);
      setActiveAccounts((a) => ({ ...a, [platform]: "" }));
    };
    const cancelGray = (platform: Platform) => {
      setRecovering(platform, false);
      const t = grayTimersRef.current[platform];
      if (t) { clearTimeout(t); grayTimersRef.current[platform] = null; }
    };
    const scheduleGray = (platform: Platform, delayMs: number) => {
      // F3 — health in doubt from the moment the grace arms (repeated arms while
      // armed are same-value no-ops → the amber state is STABLE, no flicker).
      setRecovering(platform, true);
      if (grayTimersRef.current[platform]) return; // keep the EARLIEST deadline
      grayTimersRef.current[platform] = setTimeout(() => {
        grayTimersRef.current[platform] = null;
        setRecovering(platform, false); // doubt resolved: honestly NOT connected
        setPlatformGray(platform); // honest gray — health didn't recover within grace
      }, delayMs);
    };
    // A dead socket cannot deliver comments → green must not outlive it (short grace
    // so a 1–2s transport blip never flaps the pill; the join snapshot restores truth).
    const onSocketDown = () => {
      setConnected(false);
      (["TikTok", "Facebook"] as Platform[]).forEach((p) => {
        if (serverConnectedRef.current[p]) scheduleGray(p, SOCKET_GRACE_MS);
      });
    };
    s.on("connect", () => {
      setConnected(true); joinRoom(); emitSelection();
      if (hasConnectedSocketRef.current) autoReconnectAfterDrop(); // RE-connect → restore accounts
      else hasConnectedSocketRef.current = true;                   // first connect → nothing to restore
    });
    s.on("disconnect", onSocketDown);
    s.on("connect_error", onSocketDown);
    joinRoom();
    emitSelection();
    s.on("comment", (d: ProdComment) => {
      if (!d || typeof d !== "object") return;
      // Light coercion to guarantee commentKey works; FULL normalizeComment parity
      // is deferred with the real socket (F2 — preview can't connect).
      const c: ProdComment = {
        ...d,
        platform: d.platform === "Facebook" ? "Facebook" : "TikTok",
        handle: String(d.handle || d.name || "").trim(),
        name: String(d.name || d.handle || "").trim(),
        comment: String(d.comment || "").trim(),
        timestamp: d.timestamp || new Date().toISOString(),
        time: d.time || new Date().toLocaleTimeString(),
      };
      if (!c.handle || !c.comment) return;
      if (c.sellerId && c.sellerId !== sellerId) return;
      if (c.sessionId && c.sessionId !== sessionId) return;
      // Account-leak fix — filter to the USER-SELECTED account for this platform
      // (the dropdown), not the server-driven activeAccounts. Empty selection → show
      // all (no dropdown choice yet). The server gate (emitCommentScoped) is the
      // first line of defense; this is the client-side guarantee.
      if (c.sourceUsername) {
        const sel = cleanLiveAccount(selectedRef.current[c.platform === "Facebook" ? "Facebook" : "TikTok"]);
        if (sel && cleanLiveAccount(c.sourceUsername) !== sel) return;
      }
      // Auto Mode seam — fire on the ACCEPTED comment (after every filter above),
      // before pushComment. commentKey/dedup below are unchanged (tangled zone #1).
      try { onCommentRef.current?.(c); } catch (err) { console.warn("onComment handler failed", err); }
      pushComment(c);
    });
    // #6 — server-driven connection status + active account (App.tsx 4072-4082),
    // upgraded to STATUS-TRUTH three-way handling:
    //   • connected (visible) → green NOW + cancel any pending gray.
    //   • reconnecting → TRANSITIONAL: the server health cycle usually self-heals in
    //     10–45s, so keep the current green through RECONNECT_GRACE_MS instead of
    //     flapping (symptom A); the armed timer falls to honest gray if it doesn't.
    //   • terminal not-connected (streamEnd / not_live / manual / rate_limited /
    //     stale snapshot) → honest gray IMMEDIATELY.
    s.on("platform_status", (p: { platform?: string; connected?: boolean; reconnecting?: boolean; sellerId?: string; username?: string; sessionId?: string }) => {
      if (p.sellerId && p.sellerId !== sellerId) return;
      if (p.sessionId && p.sessionId !== sessionId) return;
      const plat: Platform | "" = p.platform === "TikTok" ? "TikTok" : p.platform === "Facebook" ? "Facebook" : "";
      if (!plat) return;
      if (p.connected && !p.reconnecting) {
        cancelGray(plat);
        if (plat === "TikTok") setTtConnected(true); else setFbConnected(true);
        if (p.username) setActiveAccounts((a) => ({ ...a, [plat]: p.username as string }));
      } else if (p.reconnecting) {
        // F2 (audit) — ALWAYS arm the grace (no currently-green gate): the gate
        // read a render-mirrored ref that could be stale when connected:true and
        // reconnecting:true land in the same batch (fresh connection dying at
        // birth), silently skipping the arm and delaying the honest gray by a
        // full retry cycle. Arming while already gray is a harmless no-op (the
        // timer just re-asserts gray). Green still only returns on connected:true.
        scheduleGray(plat, RECONNECT_GRACE_MS);
      } else {
        cancelGray(plat);
        setPlatformGray(plat);
      }
    });
    s.on("live_session_ended", (e: { sellerId?: string; sessionId?: string } = {}) => {
      if (e.sellerId && e.sellerId !== sellerId) return;
      if (e.sessionId && e.sessionId !== sessionId) return;
      cancelGray("TikTok"); cancelGray("Facebook"); // terminal — no pending grace needed
      setActiveAccounts({ TikTok: "", Facebook: "" }); setTtConnected(false); setFbConnected(false); setFeed([]);
    });
    return () => {
      reconnectTimersRef.current.forEach(clearTimeout);
      reconnectTimersRef.current = [];
      cancelGray("TikTok"); cancelGray("Facebook");
      socketRef.current = null;
      s.disconnect();
    };
  }, [enabled, email, pushComment]);

  // Account-leak fix — when the user changes the dropdown selection mid-session,
  // push it to the server so the per-socket gate updates immediately (no reconnect).
  // The comment filter already reads selectedRef synchronously; this keeps the wire
  // scoped too. socket.io buffers the emit if briefly disconnected.
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    s.emit("select_account", { platform: "TikTok", username: ttSel });
    s.emit("select_account", { platform: "Facebook", username: fbSel });
  }, [ttSel, fbSel, connected]);

  // #6 — real connect: POST to the live server, then optimistically set the active
  // account (the authoritative value still arrives via platform_status). Clears the
  // feed like production's clearLiveCommentMemory.
  const connect = useCallback(async (platform: Platform, data: Record<string, string>): Promise<ConnectResult> => {
    if (!email) return { ok: false, error: "Not signed in", account: "" };
    const r = await connectPlatform(platform, data, email);
    if (r.ok) {
      connectedAcctsRef.current = { ...connectedAcctsRef.current, [platform]: r.account }; // Fix B — track for auto-restore
      setFeed([]);
      setActiveAccounts((a) => ({ ...a, [platform]: r.account }));
    }
    return r;
  }, [email]);

  // Fix B — user manually turned a platform off: forget it so auto-reconnect-after-restart
  // won't bring it back. (RedesignApp doConnect calls this in its disconnect branch.)
  const markDisconnected = useCallback((platform: Platform) => {
    connectedAcctsRef.current = { ...connectedAcctsRef.current, [platform]: "" };
  }, []);

  // Preview-only injector. With no arg it cycles the canned SYNTH comments; with a
  // `text` it injects that EXACT comment from a fresh unique commenter (each call =
  // a distinct buyer → distinct commentKey → its own auto-order) — this is how Step 7
  // exercises Auto Mode on preview (the real socket only works in the APK). Routes
  // through the SAME onComment seam + dedup pipeline a real comment would.
  const injectSynthetic = useCallback((text?: string) => {
    const i = synthIdx.current;
    synthIdx.current += 1;
    const now = new Date();
    const base = SYNTH[i % SYNTH.length];
    const c: ProdComment = {
      handle: text != null ? `tester${i}` : base.handle,
      name: text != null ? "Preview Tester" : base.name,
      comment: text != null ? text : base.text,
      platform: base.platform,
      isBuy: text != null ? true : base.isBuy,
      buyerNum: null,
      buyerData: null,
      time: now.toLocaleTimeString(),
      timestamp: now.toISOString(),
      sessionId: browserSessionId(),
    } as ProdComment;
    try { onCommentRef.current?.(c); } catch (err) { console.warn("onComment handler failed", err); }
    pushComment(c);
  }, [pushComment]);

  // Preview convenience: expose the injector on window so a tester can drive Auto
  // Mode from the console, e.g. __sflInject("D"). Gated to non-production hosts.
  useEffect(() => {
    if (!isPreviewEnv() || typeof window === "undefined") return;
    (window as unknown as { __sflInject?: (t?: string) => void }).__sflInject = injectSynthetic;
    return () => { try { delete (window as unknown as { __sflInject?: unknown }).__sflInject; } catch { /* ignore */ } };
  }, [injectSynthetic]);

  // Audit #2a — memoized: the mapping recomputes ONLY when the feed changes.
  // Un-memoized, EVERY host render (e.g. each Enterprise-price keystroke)
  // re-mapped up to 5,000 comments and forced a full list reconcile.
  // Regression: feedComments.memo.test. The feed pipeline itself (commentKey /
  // dedup / sortNewest — tangled zone #1) is untouched.
  const comments = useMemo(() => feed.map(toRedesignComment), [feed]);
  return { comments, connected, canInject: isPreviewEnv(), injectSynthetic, getComment, activeAccounts, ttConnected, fbConnected, ttRecovering, fbRecovering, connect, markDisconnected };
}
