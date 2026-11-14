// Admin → 7-11 Login: the client side of server/pc711Login.js. Every call goes to the live server
// with the admin's Supabase JWT (the server re-checks is_admin). The status is read when Admin opens
// and when the panel opens — never polled. The password and SMS code go to the server once and are
// not kept here after the call.
import { useCallback, useEffect, useState } from "react";
import { SERVER } from "./serverIdentity";
import { supabase } from "../../supabase";
import { withCodes, decodeServerJson } from "../../lib/errCodes.js";

export type Pc711State = "not_connected" | "connected" | "needs_login" | "key_missing";
export interface Pc711Status {
  state: Pc711State;
  since: string | null;
  lastOkAt: string | null;
  autoLogins: number;
  phoneTail: string;
  lastProblem: string | null;
}
export interface Pc711Answer {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

export function pc711NeedsAttention(s: Pc711Status | null | undefined): boolean {
  return Boolean(s && (s.state === "needs_login" || s.state === "key_missing"));
}

const STATES: Pc711State[] = ["not_connected", "connected", "needs_login", "key_missing"];
export function toPc711Status(j: unknown): Pc711Status | null {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const state = STATES.find((s) => s === o.state);
  if (!state) return null;
  return {
    state,
    since: typeof o.since === "string" ? o.since : null,
    lastOkAt: typeof o.lastOkAt === "string" ? o.lastOkAt : null,
    autoLogins: Number.isFinite(Number(o.autoLogins)) ? Number(o.autoLogins) : 0,
    phoneTail: typeof o.phoneTail === "string" ? o.phoneTail.slice(-3) : "",
    lastProblem: typeof o.lastProblem === "string" ? o.lastProblem : null,
  };
}

async function call(path: string, body?: Record<string, unknown>): Promise<Pc711Answer> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(withCodes(`${SERVER}${path}`), {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${session?.access_token || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = decodeServerJson(await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { ok: false, status: 0, data: { error: "unreachable" } };
  }
}

// Admin → 7-11 Login "Shadow" block (server/pc711Shadow.js): today's compared / match % per kind /
// server average ms + the last 5 mismatches (no ids). Read when the panel opens — never polled.
export interface Pc711ShadowPart { n: number; matchPct: number | null }
export interface Pc711Shadow {
  enabled: boolean;
  today: { n: number; store: Pc711ShadowPart; phone: Pc711ShadowPart; avgMs: number | null };
  mismatches: { kind: "store" | "phone"; ext: string; srv: string; at: string }[];
}
const part = (x: unknown): Pc711ShadowPart => {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const n = Number(o.n);
  const p = o.matchPct === null || o.matchPct === undefined ? null : Number(o.matchPct);
  return { n: Number.isFinite(n) ? n : 0, matchPct: p !== null && Number.isFinite(p) ? p : null };
};
export function toPc711Shadow(j: unknown): Pc711Shadow | null {
  const o = (j && typeof j === "object" ? j : null) as Record<string, unknown> | null;
  if (!o || !o.today || typeof o.today !== "object") return null;
  const t = o.today as Record<string, unknown>;
  const avg = t.avgMs === null || t.avgMs === undefined ? null : Number(t.avgMs);
  const word = (v: unknown) => String(v ?? "").replace(/[^a-z_]/g, "").slice(0, 16) || "unknown";
  return {
    enabled: o.enabled === true,
    today: { n: Number(t.n) || 0, store: part(t.store), phone: part(t.phone), avgMs: avg !== null && Number.isFinite(avg) ? avg : null },
    mismatches: (Array.isArray(o.mismatches) ? o.mismatches : []).slice(0, 5).map((m) => {
      const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { kind: x.kind === "phone" ? "phone" as const : "store" as const, ext: word(x.ext), srv: word(x.srv), at: typeof x.at === "string" ? x.at : "" };
    }),
  };
}

export const pc711Api = {
  status: async (): Promise<Pc711Status | null> => { const a = await call("/admin/pc711/status"); return a.ok ? toPc711Status(a.data) : null; },
  start: () => call("/admin/pc711/login/start", {}),
  captcha: (flowId: string) => call("/admin/pc711/login/captcha", { flowId }),
  submit: (flowId: string, mobile: string, password: string, verifyCode: string) => call("/admin/pc711/login/submit", { flowId, mobile, password, verifyCode }),
  sms: (flowId: string, code: string) => call("/admin/pc711/login/sms", { flowId, code }),
  resend: (flowId: string) => call("/admin/pc711/login/resend", { flowId }),
  back: (flowId: string) => call("/admin/pc711/login/back", { flowId }),
  disconnect: () => call("/admin/pc711/disconnect", {}),
  test: () => call("/admin/pc-server-probe", {}),
  shadow: async (): Promise<Pc711Shadow | null> => { const a = await call("/admin/pc711/shadow"); return a.ok ? toPc711Shadow(a.data) : null; },
};

/** "hh:mm" (local time) of an ISO instant, or "" when it is not a date. */
export function hhmm(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// One read on mount (when enabled) + refresh() on demand. No polling.
export function usePc711Status(enabled = true): { status: Pc711Status | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<Pc711Status | null>(null);
  const refresh = useCallback(async () => { setStatus(await pc711Api.status()); }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    pc711Api.status().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return { status, refresh };
}

// "123456" pasted into any box fills all six; anything else = the chars typed so far. When the SMS
// code may contain letters (isOtpAlnum), letters are kept and upper-cased; otherwise digits only.
export function fillSmsBoxes(prev: string[], index: number, typed: string, alnum = false): string[] {
  const clean = alnum ? String(typed || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : String(typed || "").replace(/\D/g, "");
  const next = prev.slice(0, 6);
  while (next.length < 6) next.push("");
  if (clean.length >= 6) return clean.slice(0, 6).split("");
  if (!clean) { next[index] = ""; return next; }
  for (let i = 0; i < clean.length && index + i < 6; i++) next[index + i] = clean[i];
  return next;
}
