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
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { supabase } from "../../supabase";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import type { Comment as RDComment } from "../data";

// SERVER — same resolution as App.tsx:169-173 (do NOT change names/URLs).
const DEFAULT_SERVER =
  typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:3001"
    : "https://sellerflow-live-server.onrender.com";
const SERVER = String(import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER).replace(/\/$/, "");
const LIVE_COMMENT_LIMIT = 5000;

const sellerIdOf = (email: string) => email.trim().toLowerCase();

// Same browser-session id production uses (App.tsx:147), same storage key/format
// (LS.get/LS.set use JSON) so the redesign joins the SAME live room as the prod
// tab in this browser.
const browserSessionId = (): string => {
  try {
    const raw = localStorage.getItem("sf_browser_session");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const next = `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem("sf_browser_session", JSON.stringify(next)); } catch { /* ignore */ }
  return next;
};

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

export interface UseLiveFeed {
  comments: RDComment[];
  connected: boolean;
  canInject: boolean;
  injectSynthetic: () => void;
  getComment: (id: string) => ProdComment | undefined; // 5e — resolve a feed id (commentKey) → raw comment
}

export function useLiveFeed(enabled: boolean, email: string | undefined): UseLiveFeed {
  const [feed, setFeed] = useState<ProdComment[]>([]);
  const [connected, setConnected] = useState(false);
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
    const sellerId = sellerIdOf(email);
    const sessionId = browserSessionId();
    const s: Socket = io(SERVER, {
      path: "/socket.io/",
      transports: ["websocket"],
      auth: (cb: (d: { token: string }) => void) => {
        if (!supabase) { cb({ token: "" }); return; }
        supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token || "" }));
      },
    });
    const joinRoom = () => s.emit("join_live_room", { sellerId, sessionId });
    s.on("connect", () => { setConnected(true); joinRoom(); });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));
    joinRoom();
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
      pushComment(c);
    });
    return () => { s.disconnect(); };
  }, [enabled, email, pushComment]);

  const injectSynthetic = useCallback(() => {
    const t = SYNTH[synthIdx.current % SYNTH.length];
    synthIdx.current += 1;
    const now = new Date();
    pushComment({
      handle: t.handle,
      name: t.name,
      comment: t.text,
      platform: t.platform,
      isBuy: t.isBuy,
      buyerNum: null,
      buyerData: null,
      time: now.toLocaleTimeString(),
      timestamp: now.toISOString(),
      sessionId: browserSessionId(),
    } as ProdComment);
  }, [pushComment]);

  return { comments: feed.map(toRedesignComment), connected, canInject: isPreviewEnv(), injectSynthetic, getComment };
}
