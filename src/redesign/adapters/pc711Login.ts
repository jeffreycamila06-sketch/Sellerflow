// Admin → 7-11 Login: the client side of server/pc711Login.js. Every call goes to the live server
// with the admin's Supabase JWT (the server re-checks is_admin). The status is read when Admin opens
// and when the panel opens — never polled. The password and SMS code go to the server once and are
// not kept here after the call.
import { useCallback, useEffect, useState } from "react";
import { SERVER } from "./serverIdentity";
import { supabase } from "../../supabase";

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
    const r = await fetch(`${SERVER}${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${session?.access_token || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { ok: false, status: 0, data: { error: "unreachable" } };
  }
}

export const pc711Api = {
  status: async (): Promise<Pc711Status | null> => { const a = await call("/admin/pc711/status"); return a.ok ? toPc711Status(a.data) : null; },
  start: () => call("/admin/pc711/login/start", {}),
  captcha: (flowId: string) => call("/admin/pc711/login/captcha", { flowId }),
  submit: (flowId: string, mobile: string, password: string, verifyCode: string) => call("/admin/pc711/login/submit", { flowId, mobile, password, verifyCode }),
  sms: (flowId: string, code: string) => call("/admin/pc711/login/sms", { flowId, code }),
  disconnect: () => call("/admin/pc711/disconnect", {}),
  test: () => call("/admin/pc-server-probe", {}),
};

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

// "123456" pasted into any box fills all six; anything else = the digits typed so far.
export function fillSmsBoxes(prev: string[], index: number, typed: string): string[] {
  const digits = String(typed || "").replace(/\D/g, "");
  const next = prev.slice(0, 6);
  while (next.length < 6) next.push("");
  if (digits.length >= 6) return digits.slice(0, 6).split("");
  if (!digits) { next[index] = ""; return next; }
  for (let i = 0; i < digits.length && index + i < 6; i++) next[index + i] = digits[i];
  return next;
}
