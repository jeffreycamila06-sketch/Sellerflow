// Parcel Scan FamilyMart — store # check (sql/155, server/fmStoreCheck.js). Works like the 7-11
// wrong-store-code flow (ParcelScan.tsx runStoreCheck + store_check_status), on fm_parcel_scans.
// On = the switch fm_store_check_enabled OR this login has the key "fm_store_check". Off = the
// screen never calls anything here (no server call, no new column read, no new label).
// A check NEVER blocks a save. Only a real answer is kept: 'valid' or 'not_found'. Anything else
// (timeout, offline, limit, server not deployed, an answer of 'unknown') is written nowhere and
// never replaces a real answer — the row then shows "Can't verify store" + Re-check.
// Only 'not_found' keeps a parcel out of the export file.
import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import type { FmScanRow } from "./fmScan";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export type FmStoreVerdict = "valid" | "not_found" | "unknown";
export type FmStoreAnswerStatus = "valid" | "not_found";
export const FM_STORE_CHECK_GIVE_UP_MS = 6000;   // one check gives up after this (→ unknown)
export const FM_STORE_CHECK_BACKLOG_MAX = 60;    // parcels already in the list at open: at most this many are asked per open
export const FM_STORE_CHECK_STOP_AFTER = 2;      // failures in a row → everything queued is dropped

export function fmStoreCheckVisible(a: { switchOn: boolean; previewKey: boolean }): boolean {
  return a.switchOn === true || a.previewKey === true;
}

const real = (s: unknown): s is FmStoreAnswerStatus => s === "valid" || s === "not_found";
// A parcel the check is about: not exported, a 6-digit store #.
export const fmStoreCheckable = (r: FmScanRow): boolean => !r.exportedAt && /^\d{6}$/.test(r.storeId);
// The FamilyMart "wrong store code" problem (a parcel already exported is done — never a problem).
export const fmWrongStore = (r: FmScanRow): boolean => !r.exportedAt && r.storeCheckStatus === "not_found";
export const fmStoreKey = (r: Pick<FmScanRow, "id" | "storeId">): string => `${r.id}:${r.storeId}`;

export interface FmStoreAnswer { status: FmStoreVerdict; noAnswer?: boolean }
const NO_ANSWER: FmStoreAnswer = { status: "unknown", noAnswer: true };

async function askServer(storeId: string, fresh: boolean, signal: AbortSignal): Promise<FmStoreAnswer> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(withCodes(`${SERVER}/admin/fm-store-check`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify(fresh ? { storeId, fresh: true } : { storeId }),
      signal,
    });
    const j = decodeServerJson(await r.json().catch(() => ({} as { success?: boolean; status?: string })));
    if (!r.ok || !j.success) return NO_ANSWER;
    return { status: real(j.status) ? j.status : "unknown" };
  } catch {
    return NO_ANSWER;
  }
}

// Asks the server. The WHOLE ask (the session read included) gives up after giveUpMs → unknown.
// fresh = a Re-check tap (the server asks FamilyMart again). Never throws.
export function askFmStore(storeId: string, fresh = false, giveUpMs = FM_STORE_CHECK_GIVE_UP_MS): Promise<FmStoreAnswer> {
  if (!/^\d{6}$/.test(storeId)) return Promise.resolve({ status: "unknown" });
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<FmStoreAnswer>((res) => { timer = setTimeout(() => { ctl.abort(); res(NO_ANSWER); }, giveUpMs); });
  return Promise.race([askServer(storeId, fresh, ctl.signal), giveUp]).finally(() => clearTimeout(timer));
}

// Writes a REAL answer on the seller's own row, with the store # it is for — only while the row
// still has that store #.
export async function writeFmStoreCheck(id: string, storeId: string, status: FmStoreAnswerStatus): Promise<boolean> {
  if (!real(status) || !isSupabaseConfigured || !supabase) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const me = data.session?.user?.id;
    if (!me) return false;
    const { error } = await supabase.from("fm_parcel_scans")
      .update({ store_check_status: status, store_check_at: new Date().toISOString(), store_check_store_id: storeId })
      .eq("id", id).eq("user_id", me).eq("store_id", storeId);
    return !error;
  } catch {
    return false;
  }
}

type Job = { id: string; storeId: string; backlog: boolean; fresh: boolean };

// One check at a time.
//   BACKLOG = parcels with no answer that were already in the list when the checks started
//             (ready turned true). At most FM_STORE_CHECK_BACKLOG_MAX of them are asked per open.
//   NEW     = a parcel saved / imported / whose store # changed after that, and every Re-check
//             tap. Never counted, never skipped because of that cap.
// A failure = no answer OR an answer of 'unknown'. Two in a row → everything queued right now
// (NEW too) is set aside (stop). A later NEW item is still asked. The first real answer ends the
// stop and puts everything set aside back in the queue, NEW before BACKLOG.
// busy = the parcels waiting or being asked (their row says "Checking store…").
// ready = the list on screen was read WITH the check columns.
// on / ready turning false = everything here is forgotten; a check already on its way is ignored.
export function useFmStoreChecks(on: boolean, ready: boolean, rows: FmScanRow[], setRows: Dispatch<SetStateAction<FmScanRow[]>>): {
  busy: ReadonlySet<string>; recheck: (id: string, storeId: string) => void;
} {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const rowsRef = useRef(rows);
  const queue = useRef<Job[]>([]);
  const parked = useRef<Job[]>([]);            // jobs set aside by a stop
  const inFlight = useRef<string | null>(null);
  const known = useRef<Map<string, string> | null>(null); // parcel id → the store # last seen (null = checks not started)
  const answers = useRef(new Map<string, FmStoreAnswerStatus>());
  const running = useRef(false);
  const stopped = useRef(false);
  const fails = useRef(0);
  const alive = useRef(true);
  const gen = useRef(0); // goes up when the check turns off: a loop of an older number does nothing more
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const sync = useCallback(() => {
    const next = new Set(queue.current.map(fmStoreKey));
    if (inFlight.current) next.add(inFlight.current);
    if (alive.current) setBusy((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
  }, []);

  const run = useCallback(() => {
    if (running.current || queue.current.length === 0) { sync(); return; }
    running.current = true;
    const mine = gen.current;
    const live = () => alive.current && gen.current === mine;
    void (async () => {
      try {
        for (let job = queue.current.shift(); job && live(); job = queue.current.shift()) {
          const key = fmStoreKey(job);
          const { id, storeId } = job;
          // gone, exported or its store # changed meanwhile → nothing to ask
          if (!rowsRef.current.some((x) => x.id === id && x.storeId === storeId && fmStoreCheckable(x))) continue;
          inFlight.current = key; sync();
          const a = await askFmStore(storeId, job.fresh);
          if (!live()) return; // the screen closed or the check turned off: nothing is written
          inFlight.current = null;
          if (real(a.status)) {
            const status = a.status;
            fails.current = 0;
            if (stopped.current) {
              stopped.current = false;
              const all = [...queue.current, ...parked.current];
              parked.current = [];
              queue.current = [...all.filter((j) => !j.backlog), ...all.filter((j) => j.backlog)];
            }
            answers.current.set(key, status);
            void writeFmStoreCheck(id, storeId, status); // best-effort
            setRows((list) => list.map((x) => (x.id === id && x.storeId === storeId ? { ...x, storeCheckStatus: status } : x)));
          } else if (++fails.current >= FM_STORE_CHECK_STOP_AFTER) {
            // nothing is written and the row keeps what it had; everything queued right now is set aside
            stopped.current = true;
            parked.current.push(...queue.current);
            queue.current = [];
          }
          sync();
        }
      } finally {
        if (gen.current === mine) {
          running.current = false;
          inFlight.current = null;
          sync();
        }
      }
    })();
  }, [setRows, sync]);

  const add = useCallback((job: Job) => {
    const key = fmStoreKey(job);
    if (inFlight.current === key || queue.current.some((j) => fmStoreKey(j) === key)) return; // already waiting / being asked
    parked.current = parked.current.filter((j) => fmStoreKey(j) !== key);
    const firstBacklog = queue.current.findIndex((j) => j.backlog);
    if (job.backlog || firstBacklog < 0) queue.current.push(job);
    else queue.current.splice(firstBacklog, 0, job); // NEW goes before the backlog
  }, []);

  // Before paint: a parcel that is about to be asked says "Checking store…" in its first frame.
  useLayoutEffect(() => {
    rowsRef.current = rows;
    if (!on || !ready) {
      if (known.current !== null || queue.current.length || parked.current.length || inFlight.current || running.current) {
        gen.current += 1;
        queue.current = []; parked.current = []; inFlight.current = null;
        known.current = null; answers.current = new Map();
        stopped.current = false; fails.current = 0; running.current = false;
        sync();
      }
      return;
    }
    // an answer this screen already got is never lost to a list reload that raced its write:
    // it is put back on the row and written again
    const stale = (r: FmScanRow) => fmStoreCheckable(r) && answers.current.has(fmStoreKey(r)) && r.storeCheckStatus !== answers.current.get(fmStoreKey(r));
    const lost = rows.filter(stale);
    if (lost.length) {
      for (const r of lost) void writeFmStoreCheck(r.id, r.storeId, answers.current.get(fmStoreKey(r))!);
      setRows((list) => list.map((x) => (stale(x) ? { ...x, storeCheckStatus: answers.current.get(fmStoreKey(x)) } : x)));
      return;
    }
    if (known.current === null) {
      known.current = new Map(rows.map((r) => [r.id, r.storeId]));
      rows.filter((r) => fmStoreCheckable(r) && !real(r.storeCheckStatus)).slice(0, FM_STORE_CHECK_BACKLOG_MAX)
        .forEach((r) => add({ id: r.id, storeId: r.storeId, backlog: true, fresh: false }));
    } else {
      for (const r of rows) {
        if (known.current.get(r.id) === r.storeId) continue; // a parcel not seen before, or its store # changed
        known.current.set(r.id, r.storeId);
        if (fmStoreCheckable(r) && !real(r.storeCheckStatus)) add({ id: r.id, storeId: r.storeId, backlog: false, fresh: false });
      }
    }
    run();
  }, [on, ready, rows, add, run, setRows, sync]);

  // The row's Re-check button. Asks FamilyMart again.
  const recheck = useCallback((id: string, storeId: string) => {
    if (!on || !ready || !/^\d{6}$/.test(storeId)) return;
    add({ id, storeId, backlog: false, fresh: true });
    run();
  }, [on, ready, add, run]);

  return { busy, recheck };
}
