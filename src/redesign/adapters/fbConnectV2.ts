// Build 1 — "Facebook connect safety" (switch fb_connect_v2, sql/103). Pure pieces of the
// connect / switch order, so RedesignApp's flow can be tested with spies. With the switch OFF
// every caller runs exactly today's sequence.
//   A. Facebook: the Page must be live BEFORE a session starts or the switch dialog opens.
//   B. A confirmed switch stops the OLD platform(s) first, then starts the new session,
//      then resets the board, then connects the new platform.
import type { FbConnectResult } from "./fb";

export type LivePlatform = "TikTok" | "Facebook" | "Shopee" | "Instagram";
export const SWITCH_STOP_TIMEOUT_MS = 4000;

// The live check's answer → continue, or why to stop (the caller shows the toast).
export type LiveGate = { go: true } | { go: false; why: "not_live" | "plan_expired" | "failed" };
export function liveGateOf(r: FbConnectResult): LiveGate {
  if (r.ok) return { go: true };
  if (r.reason === "not_live") return { go: false, why: "not_live" };
  if ((r.error || "").includes("plan_expired")) return { go: false, why: "plan_expired" };
  return { go: false, why: "failed" };
}

// Every connected platform other than the one being switched to (server truth: the
// "connected" flags, not the local off-latch — a local Disconnect leaves the server running).
// id = what its server stop needs ("" = nothing to send; the local latch is still set).
export function switchStopTargets(keep: LivePlatform, live: Record<LivePlatform, { connected: boolean; id: string }>): { platform: LivePlatform; id: string }[] {
  return (["TikTok", "Facebook", "Shopee", "Instagram"] as LivePlatform[])
    .filter((p) => p !== keep && live[p].connected)
    .map((p) => ({ platform: p, id: live[p].id }));
}

// Waits for the stops, at most timeoutMs. Never throws; reports each stop that failed or
// answered false (the switch goes on regardless — the seller already confirmed it).
export async function settleStops(stops: { name: string; p: Promise<unknown> }[], onFail: (name: string) => void, timeoutMs = SWITCH_STOP_TIMEOUT_MS): Promise<void> {
  const all = Promise.all(stops.map(({ name, p }) => Promise.resolve(p).then((ok) => { if (ok === false) onFail(name); }, () => onFail(name))));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise<void>((res) => { timer = setTimeout(res, timeoutMs); })]);
  if (timer) clearTimeout(timer);
}

// The confirmed switch. v2 off → start → reset → connect (today). v2 on → stop old first.
// A failed start aborts before the reset (never a session-less feed).
export async function runConfirmedSwitch(o: { v2: boolean; stopOld: () => Promise<void>; start: () => Promise<string | null>; reset: () => void; connect: () => void; startFailed: () => void }): Promise<void> {
  if (o.v2) await o.stopOld();
  const sid = await o.start();
  if (!sid) { o.startFailed(); return; }
  o.reset();
  o.connect();
}
