// INVOICING → FACEBOOK "SEND ALL IN MESSENGER" — the app half of server/fbSendAll.js (FB-2, 2026-11-26).
// The server does the sending (a job that keeps going with the app closed); the phone only asks:
//   status  → per buyer NUMBER a tag (+ the time it was sent) and the job's counts — never a PSID, a
//             comment id, a page token or Facebook's words;
//   start   → one job for the session (or one buyer); a second tap = the same job;
//   preview → the exact picture the server will send that buyer.
// While a job waits or runs the status is read again every FB_POLL_MS while the screen is in front;
// it stops when the job ends or the screen closes. Nothing is polled when no job runs.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";
import type { SavedStatus } from "./invoicing";

export const FB_POLL_MS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Send all needs a real session id (the server reads that session's orders). */
export const fbSessionOk = (id: string | null | undefined): id is string => !!id && UUID_RE.test(id);

export type FbServerTag = "not_sent" | "sending" | "sent" | "other_app" | "cant_message" | "unknown";
/** What a row shows: the server's tag, or the seller's own mark (Cancelled / Sent by hand / Can't message). */
export type FbTag = FbServerTag | "cancelled" | "by_hand";
export interface FbJob { state: string; oneBuyer: boolean; total: number; sent: number; skipped: number; failed: number; stop: string | null; startedAt: string | null; finishedAt: string | null }
export interface FbStatus { access: boolean; allowed: boolean; job: FbJob | null; needsMessaging: boolean; buyers: Map<number, { tag: FbServerTag; at: string | null }> }
const SERVER_TAGS: readonly FbServerTag[] = ["not_sent", "sending", "sent", "other_app", "cant_message", "unknown"];

async function bearer(): Promise<string> {
  try { return (supabase ? (await supabase.auth.getSession()).data.session?.access_token : "") || ""; } catch { return ""; }
}
async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(withCodes(`${SERVER}${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify(body),
  });
  const json = decodeServerJson(await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The server's status answer → FbStatus. Anything unknown is dropped. PURE. */
export function parseFbStatus(json: Record<string, unknown>): FbStatus | null {
  if (json.ok !== true) return null;
  const buyers = new Map<number, { tag: FbServerTag; at: string | null }>();
  for (const b of Array.isArray(json.buyers) ? (json.buyers as Record<string, unknown>[]) : []) {
    const n = Number(b?.n);
    const tag = String(b?.tag || "") as FbServerTag;
    if (Number.isInteger(n) && n > 0 && SERVER_TAGS.includes(tag)) buyers.set(n, { tag, at: strOrNull(b.at) });
  }
  const j = json.job && typeof json.job === "object" ? (json.job as Record<string, unknown>) : null;
  return {
    access: json.access === true, allowed: json.allowed === true, needsMessaging: json.needsMessaging === true, buyers,
    job: j ? { state: String(j.state || ""), oneBuyer: j.oneBuyer === true, total: num(j.total), sent: num(j.sent), skipped: num(j.skipped), failed: num(j.failed), stop: strOrNull(j.stop), startedAt: strOrNull(j.startedAt), finishedAt: strOrNull(j.finishedAt) } : null,
  };
}
export const fbJobActive = (job: FbJob | null | undefined): boolean => !!job && (job.state === "queued" || job.state === "running");

export async function fbSendAllStatus(sessionId: string): Promise<FbStatus | null> {
  try {
    const { status, json } = await post("/fb/sendall/status", { sessionId });
    return status === 200 ? parseFbStatus(json) : null;
  } catch { return null; }
}
export async function fbSendAllStart(sessionId: string, o: { buyerNumber?: number; lang: string; currency: string }): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  try {
    const { status, json } = await post("/fb/sendall/start", { sessionId, ...(o.buyerNumber ? { buyerNumber: o.buyerNumber } : {}), lang: o.lang, currency: o.currency });
    if (status === 200 && json.ok === true) return { ok: true, already: json.already === true };
    return { ok: false, error: status === 403 ? "not_allowed" : "start_failed" };
  } catch { return { ok: false, error: "unreachable" }; }
}
export async function fbSendAllPreview(sessionId: string, buyerNumber: number, lang: string, currency: string): Promise<string | null> {
  try {
    const { status, json } = await post("/fb/sendall/preview", { sessionId, buyerNumber, lang, currency });
    const png = typeof json.png === "string" ? json.png : "";
    return status === 200 && json.ok === true && /^[A-Za-z0-9+/]+={0,2}$/.test(png) ? `data:image/png;base64,${png}` : null;
  } catch { return null; }
}

/** One row's tag. The seller's own marks win (Cancelled first); a real Messenger send wins over "by hand". PURE. */
export function fbTagOf(server: { tag: FbServerTag } | undefined, saved: SavedStatus | undefined): FbTag {
  if (saved?.status === "cancelled") return "cancelled";
  if (server?.tag === "sent") return "sent";
  if (saved?.status === "sent") return "by_hand";
  if (saved?.status === "skipped") return "cant_message";
  return server?.tag ?? "not_sent";
}
/** Send (the row / the sheet) and "K left" count only these. */
export const fbSendable = (tag: FbTag): boolean => tag === "not_sent" || tag === "other_app";
export type FbFilter = "all" | "not_sent" | "sent";
export const fbIsSent = (tag: FbTag): boolean => tag === "sent" || tag === "by_hand";
export const fbInFilter = (tag: FbTag, f: FbFilter): boolean => f === "all" || (f === "sent" ? fbIsSent(tag) : !fbIsSent(tag) && tag !== "cancelled");
export function fbCounts(tags: readonly FbTag[]): { all: number; active: number; sent: number; notSent: number; left: number; otherApp: number } {
  const active = tags.filter((x) => x !== "cancelled");
  return {
    all: tags.length, active: active.length,
    sent: active.filter(fbIsSent).length, notSent: active.filter((x) => !fbIsSent(x)).length,
    left: active.filter(fbSendable).length, otherApp: active.filter((x) => x === "other_app").length,
  };
}
export type FbState = "loading" | "ready" | "error";
/** The status of one session: read when the screen opens / the session changes, again after a tap,
 *  and every FB_POLL_MS while a job waits or runs and the screen is in front. */
export function useFbSendAll(sessionId: string | null, enabled: boolean): { state: FbState; data: FbStatus | null; reload: () => void } {
  const [got, setGot] = useState<{ key: string; data: FbStatus | null; state: FbState }>({ key: "", data: null, state: "loading" });
  const [turn, setTurn] = useState(0);
  const reload = useCallback(() => setTurn((n) => n + 1), []);
  const key = enabled && fbSessionOk(sessionId) ? sessionId : "";
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fbSendAllStatus(key).then((r) => {
      if (!alive || keyRef.current !== key) return;
      setGot((g) => (r ? { key, data: r, state: "ready" } : { key, data: g.key === key ? g.data : null, state: g.key === key && g.data ? "ready" : "error" }));
    });
    return () => { alive = false; };
  }, [key, turn]);
  const data = got.key === key ? got.data : null;
  const active = fbJobActive(data?.job);
  useEffect(() => {
    if (!key || !active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (typeof document === "undefined" || document.visibilityState !== "hidden") reload(); else arm(); }, FB_POLL_MS); };
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [key, active, turn, reload]);
  return { state: key ? (got.key === key ? got.state : "loading") : "error", data, reload };
}
