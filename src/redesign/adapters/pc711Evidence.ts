// Admin → 7-11 Login → Evidence (sql/172, server/pc711Evidence.js). Read when the panel opens or a
// filter / page changes — never polled. Admin only (the server re-checks is_admin). One check's
// details include the FULL phone (Jeff's decision); it is shown, never stored here.
import { pc711Call } from "./pc711Login";

export type Pc711EvDay = "today" | "7days";
export type Pc711EvFilter = "all" | "mismatch" | "recheck" | "mirror" | "error";
export const PC711_EV_FILTERS: Pc711EvFilter[] = ["all", "mismatch", "recheck", "mirror", "error"];
export type Pc711EvSource = "fresh" | "remembered" | "unknown";

export interface Pc711EvPair { mode: "after" | "mirror"; kind: "store" | "phone" | "frozen"; source: Pc711EvSource; compared: number; agree: number }
export interface Pc711EvTotals {
  rows: number; pairs: Pc711EvPair[];
  errors: { after: number; mirror: number }; rechecks: number; flags: number; reasked: number;
  mirror: { n: number; serverFirst: number; extensionFirst: number; avgFirstByMs: number | null; late: number; timeout: number };
  storeAge: { n: number; avgS: number | null; maxS: number | null };
  restricted: { agree: number; disagree: number };
}
export type Pc711StopRule = "phone_time" | "waited" | "store_unknown";
export interface Pc711SelfStop { silentSince: string | null; lastCheckAt: string | null; lastStop: { at: string; rule: Pc711StopRule; value: number | null; parcels: number | null } | null }
export interface Pc711EvSummary { day: Pc711EvDay; mirrorEnabled: boolean; totals: Pc711EvTotals; selfStop: Pc711SelfStop }
export interface Pc711EvRow {
  id: number; at: string; kind: "store" | "phone" | "frozen"; round: number; mode: "after" | "mirror"; flag: string | null;
  result: "match" | "mismatch" | "error" | "waiting" | "none";
  ext: string | null; srv: string | null; source: Pc711EvSource | null; late: boolean; timeout: boolean;
  first: string | null; firstByMs: number | null; reaskN: number; reask1: string | null; reask2: string | null;
  failStep: string | null; failHttp: number | null; failReason: string | null; failAt: string | null; ms: number;
}
export interface Pc711EvPage { page: number; more: boolean; rows: Pc711EvRow[] }

const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const numOrNull = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const word = (v: unknown, max = 32) => (v == null || v === "" ? null : String(v).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, max) || null);
const time = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const KINDS = ["store", "phone", "frozen"] as const;
const kindOf = (v: unknown) => (KINDS.includes(v as never) ? (v as Pc711EvRow["kind"]) : "store");
const sourceOf = (v: unknown): Pc711EvSource | null => (v === "fresh" || v === "remembered" || v === "unknown" ? v : null);

export function toPc711EvSummary(j: unknown): Pc711EvSummary | null {
  const o = obj(j);
  if (!o.totals || typeof o.totals !== "object") return null;
  const t = obj(o.totals), m = obj(t.mirror), a = obj(t.storeAge), r = obj(t.restricted), e = obj(t.errors);
  const pairs = (Array.isArray(t.pairs) ? t.pairs : []).map((x) => {
    const p = obj(x);
    return { mode: p.mode === "mirror" ? "mirror" : "after", kind: kindOf(p.kind), source: sourceOf(p.source) ?? "unknown", compared: num(p.compared), agree: num(p.agree) } as Pc711EvPair;
  });
  const ss = obj(o.selfStop), ls = obj(ss.lastStop);
  const rule = ls.rule === "phone_time" || ls.rule === "waited" || ls.rule === "store_unknown" ? ls.rule : null;
  const selfStop: Pc711SelfStop = {
    silentSince: time(ss.silentSince), lastCheckAt: time(ss.lastCheckAt),
    lastStop: rule && time(ls.at) ? { at: time(ls.at)!, rule, value: numOrNull(ls.value), parcels: numOrNull(ls.parcels) } : null,
  };
  return {
    day: o.day === "7days" ? "7days" : "today", mirrorEnabled: o.mirrorEnabled === true, selfStop,
    totals: {
      rows: num(t.rows), pairs, errors: { after: num(e.after), mirror: num(e.mirror) }, rechecks: num(t.rechecks), flags: num(t.flags), reasked: num(t.reasked),
      mirror: { n: num(m.n), serverFirst: num(m.serverFirst), extensionFirst: num(m.extensionFirst), avgFirstByMs: numOrNull(m.avgFirstByMs), late: num(m.late), timeout: num(m.timeout) },
      storeAge: { n: num(a.n), avgS: numOrNull(a.avgS), maxS: numOrNull(a.maxS) },
      restricted: { agree: num(r.agree), disagree: num(r.disagree) },
    },
  };
}

/** One list row (no phone, no store, no message — those are in the details only). */
export function toPc711EvRow(x: unknown): Pc711EvRow {
  const o = obj(x);
  const result: Pc711EvRow["result"] = o.match === true ? "match" : o.match === false ? "mismatch"
    : o.fail_reason ? "error" : o.mode === "mirror" && !o.ext_at && !o.pair_closed ? "waiting" : "none";
  return {
    id: num(o.id), at: time(o.at) ?? "", kind: kindOf(o.kind), round: Math.max(1, num(o.round, 1)), mode: o.mode === "mirror" ? "mirror" : "after",
    flag: word(o.flag), result, ext: word(o.ext_verdict, 16), srv: word(o.srv_verdict, 16), source: sourceOf(o.ext_source),
    late: o.ext_late === true, timeout: o.ext_timeout === true, first: word(o.first, 12), firstByMs: numOrNull(o.first_by_ms),
    reaskN: num(o.reask_n), reask1: word(o.reask1_word), reask2: word(o.reask2_word),
    failStep: word(o.fail_step, 24), failHttp: numOrNull(o.fail_http), failReason: word(o.fail_reason), failAt: time(o.fail_at), ms: num(o.srv_ms),
  };
}
export function toPc711EvPage(j: unknown): Pc711EvPage | null {
  const o = obj(j);
  if (!Array.isArray(o.rows)) return null;
  return { page: num(o.page), more: o.more === true, rows: o.rows.slice(0, 20).map(toPc711EvRow) };
}

export const pc711EvidenceApi = {
  summary: async (day: Pc711EvDay): Promise<Pc711EvSummary | null> => {
    const a = await pc711Call(`/admin/pc711/evidence/totals?day=${encodeURIComponent(day)}`);
    return a.ok ? toPc711EvSummary(a.data) : null;
  },
  list: async (day: Pc711EvDay, filter: Pc711EvFilter, page: number): Promise<Pc711EvPage | null> => {
    const a = await pc711Call(`/admin/pc711/evidence?day=${encodeURIComponent(day)}&filter=${encodeURIComponent(filter)}&page=${Math.max(0, Math.floor(page))}`);
    return a.ok ? toPc711EvPage(a.data) : null;
  },
  detail: async (id: number): Promise<Record<string, unknown> | null> => {
    const a = await pc711Call(`/admin/pc711/evidence/${Math.max(0, Math.floor(id))}`);
    return a.ok && a.data.row && typeof a.data.row === "object" ? (a.data.row as Record<string, unknown>) : null;
  },
};

/** The totals of one mode + kind, split by source: { fresh, remembered, unknown } → "agree/compared". */
export function pairsBySource(pairs: Pc711EvPair[], mode: "after" | "mirror", kind: "phone" | "store"): Record<Pc711EvSource, { agree: number; compared: number }> {
  const out: Record<Pc711EvSource, { agree: number; compared: number }> = { fresh: { agree: 0, compared: 0 }, remembered: { agree: 0, compared: 0 }, unknown: { agree: 0, compared: 0 } };
  for (const p of pairs) if (p.mode === mode && p.kind === kind) { out[p.source].agree += p.agree; out[p.source].compared += p.compared; }
  return out;
}
