// Admin → Controls → "Live Pulse" monitor tile (2026-11-27): how many TikTok lives run now against the
// limit. The number and the limit come from the SAME server answer as the "TikTok connection limit"
// card's "live now X/Y" (loadTikTokCooldownStatus → usage.concurrent / usage.concurrentLimit, an
// admin-only server route) — the limit is never written in the app, so it follows a plan upgrade.
// Read once when the Admin screen shows, then every 60 s while the page is in front; nothing while the
// page is hidden or after the screen is left. Counts only — no money.
import { useEffect, useState } from "react";
import { loadTikTokCooldownStatus, USAGE_WARN_RATIO, type CooldownStatus } from "./tiktokConnectLimit";

export const LIVE_TILE_REFRESH_MS = 60_000;
/** Amber from this share of the limit; red from the TikTok card's own warn share (70 %). */
export const LIVE_AMBER_RATIO = 0.6;
export const LIVE_RED_RATIO = USAGE_WARN_RATIO;

export interface LiveCount { live: number; limit: number }
export type LiveLevel = "ok" | "warn" | "bad" | "unknown";

/** The live count from the server's answer, or null when it has no usable limit. */
export function liveCountFrom(status: CooldownStatus | undefined | null): LiveCount | null {
  const u = status?.usage;
  if (!u) return null;
  const live = Number(u.concurrent), limit = Number(u.concurrentLimit);
  if (!Number.isFinite(live) || live < 0 || !Number.isFinite(limit) || limit <= 0) return null;
  return { live, limit };
}

/** green < 60 %, amber ≥ 60 %, red ≥ 70 % of the limit (compared in whole numbers — no rounding drift). */
export function liveLevel(c: LiveCount | null): LiveLevel {
  if (!c) return "unknown";
  if (c.live * 100 >= c.limit * Math.round(LIVE_RED_RATIO * 100)) return "bad";
  if (c.live * 100 >= c.limit * Math.round(LIVE_AMBER_RATIO * 100)) return "warn";
  return "ok";
}

export const LEVEL_COLOR: Record<LiveLevel, string> = {
  ok: "var(--ok)", warn: "var(--warn)", bad: "var(--danger)", unknown: "var(--text-muted)",
};

const pageVisible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

/** One read now, then every 60 s while the page is in front. `enabled` false = no read at all. */
export function useLiveCount(enabled: boolean): { count: LiveCount | null; state: "loading" | "ok" | "error" } {
  const [count, setCount] = useState<LiveCount | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    if (!enabled) return;
    let alive = true, busy = false, last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const schedule = () => {
      stop();
      if (!alive || busy || !pageVisible()) return;
      timer = setTimeout(() => { void read(); }, Math.max(0, last + LIVE_TILE_REFRESH_MS - Date.now()));
    };
    const read = async () => {
      if (!alive || busy) return;
      stop();
      busy = true; last = Date.now();
      const r = await loadTikTokCooldownStatus();
      busy = false;
      if (!alive) return;
      const c = r.ok ? liveCountFrom(r.status) : null;
      setCount(c); setState(c ? "ok" : "error");
      schedule();
    };
    const onVisibility = () => {
      if (!pageVisible()) { stop(); return; }
      if (Date.now() - last >= LIVE_TILE_REFRESH_MS) void read(); else schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (pageVisible()) void read();
    return () => { alive = false; stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [enabled]);
  return { count, state };
}
