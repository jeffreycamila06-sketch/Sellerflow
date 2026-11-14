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

// Admin → 7-11 Login "Shadow" block (server/pc711Shadow.js): what the server answered compared with
// the extension. Read when the panel opens / a filter changes — never polled. No ids, no phone, no store.
// n = compared with a real server answer (match true + false); errors = server errors (match NULL).
export interface Pc711ShadowPart { n: number; matchPct: number | null; errors: number }
export interface Pc711ShadowTotals {
  n: number; compared: number; matchPct: number | null; errors: number;
  store: Pc711ShadowPart; phone: Pc711ShadowPart; frozen: Pc711ShadowPart; avgMs: number | null; errorsByStep: Record<string, number>;
}
export type Pc711ShadowKind = "store" | "phone" | "frozen";
export interface Pc711Shadow { enabled: boolean; today: Pc711ShadowTotals }
export interface Pc711ShadowStep { s: string; http: number; ms: number; ok: boolean; w?: string }
export interface Pc711ShadowRow {
  at: string; kind: Pc711ShadowKind; result: "match" | "mismatch" | "error" | "ext_unknown";
  ext: string; srv: string; raw: string | null; gapS: number | null;
  failStep: string | null; failHttp: number | null; failReason: string | null; ms: number; steps: Pc711ShadowStep[];
}
export type Pc711ShadowDay = "today" | "yesterday" | "2days" | "7days" | "30days";
export type Pc711ShadowFilter = "all" | "mismatch" | "error";
export type Pc711ShadowKindFilter = "all" | Pc711ShadowKind;
export interface Pc711ShadowHistory {
  page: number; more: boolean; rows: Pc711ShadowRow[];
  days: Record<string, { compared: number; matchPct: number | null; errors: number }>;
}
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const numOrNull = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const word = (v: unknown, max = 24) => String(v ?? "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, max);
const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const part = (x: unknown): Pc711ShadowPart => {
  const o = obj(x);
  return { n: num(o.n), matchPct: numOrNull(o.matchPct), errors: Math.max(0, num(o.errors)) };
};
const totals = (x: unknown): Pc711ShadowTotals => {
  const o = obj(x);
  const by: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.errorsByStep))) if (num(v) > 0) by[word(k)] = num(v);
  return { n: num(o.n), compared: num(o.compared), matchPct: numOrNull(o.matchPct), errors: num(o.errors), store: part(o.store), phone: part(o.phone), frozen: part(o.frozen), avgMs: numOrNull(o.avgMs), errorsByStep: by };
};
export function toPc711Shadow(j: unknown): Pc711Shadow | null {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || !o.today || typeof o.today !== "object") return null;
  return { enabled: o.enabled === true, today: totals(o.today) };
}
export function toPc711ShadowHistory(j: unknown): Pc711ShadowHistory | null {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.rows)) return null;
  const days: Pc711ShadowHistory["days"] = {};
  for (const [k, v] of Object.entries(obj(o.days))) { const d = obj(v); days[word(k, 10)] = { compared: num(d.compared), matchPct: numOrNull(d.matchPct), errors: num(d.errors) }; }
  return {
    page: num(o.page), more: o.more === true, days,
    rows: o.rows.slice(0, 20).map((r) => {
      const x = obj(r);
      const result = x.result === "match" || x.result === "mismatch" || x.result === "ext_unknown" ? x.result : "error";
      return {
        at: typeof x.at === "string" ? x.at : "", kind: x.kind === "phone" || x.kind === "frozen" ? x.kind : "store", result,
        ext: word(x.ext, 16), srv: word(x.srv, 16), raw: x.raw ? word(x.raw, 28) : null, gapS: numOrNull(x.gapS),
        failStep: x.failStep ? word(x.failStep) : null, failHttp: numOrNull(x.failHttp), failReason: x.failReason ? word(x.failReason, 32) : null,
        ms: num(x.ms),
        steps: (Array.isArray(x.steps) ? x.steps : []).slice(0, 20).map((y) => {
          const z = obj(y);
          return { s: word(z.s), http: num(z.http), ms: num(z.ms), ok: z.ok === true, ...(z.w ? { w: word(z.w, 32) } : {}) };
        }),
      } as Pc711ShadowRow;
    }),
  };
}

/** Taipei (UTC+8) "MM/DD HH:mm:ss" and the Taipei day key "YYYY-MM-DD" of an ISO instant. */
const tp = (iso: string) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? new Date(ms + 8 * 3600 * 1000) : null; };
const p2 = (n: number) => String(n).padStart(2, "0");
export function taipeiStamp(iso: string): string {
  const d = tp(iso);
  return d ? `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}` : "—";
}
export function taipeiDayKey(iso: string): string {
  const d = tp(iso);
  return d ? `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` : "";
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
  shadowHistory: async (day: Pc711ShadowDay, filter: Pc711ShadowFilter, page: number, kind: Pc711ShadowKindFilter = "all"): Promise<Pc711ShadowHistory | null> => {
    const a = await call(`/admin/pc711/shadow/history?day=${encodeURIComponent(day)}&filter=${encodeURIComponent(filter)}&kind=${encodeURIComponent(kind)}&page=${Math.max(0, Math.floor(page))}`);
    return a.ok ? toPc711ShadowHistory(a.data) : null;
  },
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
