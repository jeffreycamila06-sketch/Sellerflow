// Parcel Scan FamilyMart — store # check (sql/154, server/fmStoreCheck.js). Works like the 7-11
// wrong-store-code flow (ParcelScan.tsx runStoreCheck + store_check_status), on fm_parcel_scans.
// On = the switch fm_store_check_enabled OR this login has the key "fm_store_check". Off = the
// screen never calls anything here (no server call, no new column read, no new label).
// A check NEVER blocks a save: any doubt (timeout, offline, limit, server not deployed) is
// 'unknown' ("Can't verify store" + Re-check). Only 'not_found' keeps a parcel out of the file.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import type { FmScanRow } from "./fmScan";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export type FmStoreVerdict = "valid" | "not_found" | "unknown";
export const FM_STORE_CHECK_GIVE_UP_MS = 6000;  // one check gives up after this (→ unknown)
export const FM_STORE_CHECK_MAX_PER_OPEN = 60;  // automatic checks per screen open, at most
export const FM_STORE_CHECK_STOP_AFTER = 2;     // no-answers in a row → no more automatic checks this open

export function fmStoreCheckVisible(a: { switchOn: boolean; previewKey: boolean }): boolean {
  return a.switchOn === true || a.previewKey === true;
}

// Not exported, a 6-digit store #, no answer yet (null). 'unknown' is an answer: the seller taps Re-check.
export const needsFmStoreCheck = (r: FmScanRow): boolean => !r.exportedAt && /^\d{6}$/.test(r.storeId) && r.storeCheckStatus == null;
// The FamilyMart "wrong store code" problem (a parcel already exported is done — never a problem).
export const fmWrongStore = (r: FmScanRow): boolean => !r.exportedAt && r.storeCheckStatus === "not_found";

export interface FmStoreAnswer { status: FmStoreVerdict; noAnswer?: boolean }

// Asks the server. Gives up after giveUpMs. Never throws. noAnswer = the server did not answer
// (offline, timeout, limit, not deployed) — as opposed to an answer that says 'unknown'.
export async function askFmStore(storeId: string, giveUpMs = FM_STORE_CHECK_GIVE_UP_MS): Promise<FmStoreAnswer> {
  if (!/^\d{6}$/.test(storeId)) return { status: "unknown" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), giveUpMs);
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(withCodes(`${SERVER}/admin/fm-store-check`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ storeId }),
      signal: ctl.signal,
    });
    const j = decodeServerJson(await r.json().catch(() => ({} as { success?: boolean; status?: string })));
    if (!r.ok || !j.success) return { status: "unknown", noAnswer: true };
    return { status: j.status === "valid" || j.status === "not_found" ? j.status : "unknown" };
  } catch {
    return { status: "unknown", noAnswer: true };
  } finally {
    clearTimeout(timer);
  }
}

// Writes the answer on the seller's own row — only while the row still has that store #.
export async function writeFmStoreCheck(id: string, storeId: string, status: FmStoreVerdict): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const me = data.session?.user?.id;
    if (!me) return false;
    const { error } = await supabase.from("fm_parcel_scans")
      .update({ store_check_status: status, store_check_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", me).eq("store_id", storeId);
    return !error;
  } catch {
    return false;
  }
}

// Checks, one after the other, every not-exported parcel with no answer yet: the ones on screen
// when it opens, a parcel just saved or imported, a parcel whose store # was just changed (its
// old answer is cleared by the save). The row shows "checking", then the answer. recheck() =
// the row's Re-check button. checking = a check is running or waiting (Export waits for it; one
// check never takes more than FM_STORE_CHECK_GIVE_UP_MS, and two no-answers in a row end the
// automatic checks for this open, so the button can never stay stuck).
export function useFmStoreChecks(on: boolean, rows: FmScanRow[], setRows: Dispatch<SetStateAction<FmScanRow[]>>): { checking: boolean; recheck: (id: string, storeId: string) => void } {
  const [busy, setBusy] = useState(false);
  const rowsRef = useRef(rows);
  const manual = useRef<{ id: string; storeId: string }[]>([]);
  const running = useRef(false);
  const stopped = useRef(false);
  const misses = useRef(0);
  const autoCount = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(() => {
    if (running.current) return;
    const next = (): { id: string; storeId: string; auto: boolean } | null => {
      const m = manual.current.shift();
      if (m) return { ...m, auto: false };
      if (stopped.current) return null;
      const r = rowsRef.current.find(needsFmStoreCheck);
      return r ? { id: r.id, storeId: r.storeId, auto: true } : null;
    };
    let job = next();
    if (!job) return;
    running.current = true;
    setBusy(true);
    void (async () => {
      try {
        for (; job && alive.current; job = next()) {
          const { id, storeId, auto } = job;
          if (auto && ++autoCount.current >= FM_STORE_CHECK_MAX_PER_OPEN) stopped.current = true;
          const same = (x: FmScanRow) => x.id === id && x.storeId === storeId;
          const put = (status: string) => {
            rowsRef.current = rowsRef.current.map((x) => (same(x) ? { ...x, storeCheckStatus: status } : x)); // the loop's own view, before React renders
            setRows((list) => list.map((x) => (same(x) ? { ...x, storeCheckStatus: status } : x)));
          };
          put("checking");
          const a = await askFmStore(storeId);
          if (a.noAnswer) { if (++misses.current >= FM_STORE_CHECK_STOP_AFTER) stopped.current = true; }
          else { misses.current = 0; if (!auto) stopped.current = autoCount.current >= FM_STORE_CHECK_MAX_PER_OPEN; }
          void writeFmStoreCheck(id, storeId, a.status); // best-effort
          if (!alive.current) return;
          put(a.status);
        }
      } finally {
        running.current = false;
        if (alive.current) setBusy(false);
      }
    })();
  }, [setRows]);

  useEffect(() => {
    rowsRef.current = rows;
    if (on) run();
  }, [on, rows, run]);

  const recheck = useCallback((id: string, storeId: string) => {
    if (!on || !/^\d{6}$/.test(storeId)) return;
    manual.current.push({ id, storeId });
    run();
  }, [on, run]);

  return { checking: on && (busy || rows.some((r) => !r.exportedAt && r.storeCheckStatus === "checking")), recheck };
}
