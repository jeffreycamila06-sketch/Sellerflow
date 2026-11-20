// Admin → 7-11 Login → "Who is checking": the client side of GET /admin/pc711/duty
// (server/pc711Duty.js — Admin only, read only, counts and times only).
//
// The answer is read when the panel opens, then every 30 seconds while the panel is open AND the page
// is in front. A hidden page asks nothing; when it comes back, a read that is due runs at once.
// Every timer and listener is removed when the panel closes.
import { useEffect, useState } from "react";
import { pc711Call, taipeiStamp } from "./pc711Login";

export type Pc711DutyReason = "silent" | "degraded";
/** the server's kept E-Map store-search session: answers now · being repaired / opened · neither */
export type Pc711StoreSession = "ready" | "opening" | "not_ready";
export interface Pc711DutyLast { start: string; end: string; reason: Pc711DutyReason | null }
export interface Pc711Duty {
  /** "on" = the backup switch is on and its tables exist; "off" = switch off or sql/179 not applied */
  backup: "on" | "off";
  onDuty: boolean;
  /** the server is logged out of 7-11 (with onDuty → the red state) */
  loggedOut: boolean;
  reason: Pc711DutyReason | null;
  since: string | null;
  /** parcels the server answered in this duty (null = no number) */
  answered: number | null;
  answeredMore: boolean;
  /** the checker laptop's own device label ("Lenovo"); "" = not known */
  label: string;
  lastCallAt: string | null;
  /** the last finished take-over; null = there was none */
  last: Pc711DutyLast | null;
  /** the kept E-Map session (only while the backup is on); null = not known */
  storeSession: Pc711StoreSession | null;
  /** the server's clock minus this device's clock when the answer arrived (ms) */
  skewMs: number;
}
export type Pc711DutyState = "normal" | "duty" | "duty_out" | "off";

export const DUTY_REFRESH_MS = 30 * 1000;

const isoOrNull = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const reasonOf = (v: unknown): Pc711DutyReason | null => (v === "silent" || v === "degraded" ? v : null);
// the same two shapes the server allows (server/pc711Duty.js machineLabel) — checked again here
const labelOf = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= 20 && !/\d{5,}/.test(s) && /^[A-Za-z][A-Za-z0-9._-]*( [0-9a-z]{4})?$/.test(s) ? s : "";
};

/** The server's answer → what the card shows. Anything that is not the expected shape → null. */
export function toPc711Duty(j: unknown, nowMs: number = Date.now()): Pc711Duty | null {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  if (o.backup !== "on" && o.backup !== "off") return null;
  const on = o.backup === "on";
  const onDuty = on && o.onDuty === true;
  const checker = (o.checker && typeof o.checker === "object" ? o.checker : {}) as Record<string, unknown>;
  const l = (o.last && typeof o.last === "object" ? o.last : null) as Record<string, unknown> | null;
  const start = l ? isoOrNull(l.start) : null, end = l ? isoOrNull(l.end) : null;
  const serverNow = isoOrNull(o.now);
  const n = Number(o.answered);
  return {
    backup: on ? "on" : "off",
    onDuty,
    loggedOut: o.loggedOut === true,
    reason: onDuty ? reasonOf(o.reason) : null,
    since: onDuty ? isoOrNull(o.since) : null,
    answered: onDuty && o.answered !== null && Number.isInteger(n) && n >= 0 ? n : null,
    answeredMore: onDuty && o.answeredMore === true,
    label: labelOf(checker.label),
    lastCallAt: isoOrNull(checker.lastCallAt),
    last: start && end && Date.parse(start) <= Date.parse(end) ? { start, end, reason: reasonOf(l!.reason) } : null,
    storeSession: on && (o.storeSession === "ready" || o.storeSession === "opening" || o.storeSession === "not_ready") ? o.storeSession : null,
    skewMs: serverNow ? Date.parse(serverNow) - nowMs : 0,
  };
}

/** Which of the four states the card is in. */
export function dutyState(d: Pc711Duty): Pc711DutyState {
  if (d.backup !== "on") return "off";
  if (d.onDuty) return d.loggedOut ? "duty_out" : "duty";
  return "normal";
}

/** true while the server is the one checking (the "checks are paused" sentence is not true then). */
export function serverOnDuty(d: Pc711Duty | null | undefined): boolean {
  return Boolean(d && d.backup === "on" && d.onDuty);
}

/** A length of time in a few words: "4 s", "22 min", "1 h 12 min", "3 d 4 h". Never negative. */
export function spanWords(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Taipei "MM/DD HH:mm" of an ISO time ("—" when it is not a time). */
export function taipeiMinute(iso: string | null): string {
  const s = iso ? taipeiStamp(iso) : "—";
  return s === "—" ? s : s.slice(0, 11);
}
/** "11/17 03:12 → 03:58" (same Taipei day) or "11/17 23:50 → 11/18 00:36". */
export function taipeiRange(start: string, end: string): string {
  const a = taipeiMinute(start), b = taipeiMinute(end);
  return a.slice(0, 5) === b.slice(0, 5) ? `${a} → ${b.slice(6)}` : `${a} → ${b}`;
}

export const pc711DutyApi = {
  read: async (): Promise<Pc711Duty | null> => {
    const a = await pc711Call("/admin/pc711/duty");
    return a.ok ? toPc711Duty(a.data) : null;
  },
};

const inFront = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * undefined = not read yet · null = the read failed · else the answer.
 * open = the panel shows its status view. One read at open, then one every DUTY_REFRESH_MS while the
 * page is in front; none while it is hidden; nothing left running after the panel closes.
 */
export function usePc711Duty(open = true): Pc711Duty | null | undefined {
  const [duty, setDuty] = useState<Pc711Duty | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let busy = false;
    let lastAt = -Infinity;                                   // when the last read STARTED
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      if (!alive || busy) return;
      busy = true; lastAt = Date.now();
      let d: Pc711Duty | null;
      try { d = await pc711DutyApi.read(); } catch { d = null; }
      busy = false;
      if (alive) setDuty(d);
    };
    // the next read: when the last one is DUTY_REFRESH_MS old — at once if it already is.
    // Never while a read is still on its way (its own answer plans the next one).
    const plan = () => {
      if (!alive || timer !== null || busy || !inFront()) return;
      const wait = Math.max(0, lastAt + DUTY_REFRESH_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        if (!alive || !inFront()) return;                     // the page went behind meanwhile: ask nothing
        void read().then(plan);
      }, wait);
    };
    const onVisibility = () => {
      if (inFront()) { plan(); return; }
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };
    if (inFront()) void read().then(plan);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open]);
  return duty;
}
