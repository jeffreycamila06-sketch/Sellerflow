// The Scan QR → Customers lookup, as ONE hook used by BOTH Parcel Scan screens (7-11 and
// FamilyMart) so they can never drift. The screen keeps doing exactly what it does today on a
// scan (username in the field, toast); then it calls scanned(handle) and this hook does the rest.
//
// `on` false (switch off and login not listed) → scanned() returns at once: no read, no state.
//
// Guards (docs/plans/scan-qr-lookup-plan.md §4):
//  B1  a new scan first blanks the details the lookup wrote and nobody touched since
//  B7  an answer is written only while name, phone and store are still blank — else a suggestion
//  B8/B9/B11  every scan / reset takes a new number; an answer with an old number is dropped
//  B20 reset() at Clear / Cancel / Save / next photo / edit start / Import
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isLookupable, lookupCustomersByHandle, lookupKey, lookupView, untouchedFilled,
  type LookupFields, type ScanQrLookupMark, type ScanQrLookupRow, type ScanQrLookupStore, type ScanQrLookupView,
} from "./scanQrLookup";

export interface ScanQrLookupOpts {
  on: boolean;
  store: ScanQrLookupStore;
  /** true while a saved parcel is being edited — no lookup then. */
  blocked: boolean;
  /** The mark kept with this screen's ⇄ draft (null = none). */
  initial: ScanQrLookupMark | null;
  /** The form as rendered now. */
  fields: LookupFields & { handle: string };
  /** Write name / phone / store. `fn` gets the latest values and returns only what changes. */
  setFields: (fn: (cur: LookupFields) => Partial<LookupFields>) => void;
  /** Details were written: "auto" (one record, blank form) or "picked" (the seller tapped a record / Use). */
  onApplied?: (how: "auto" | "picked") => void;
}
export interface ScanQrLookupApi {
  mark: ScanQrLookupMark | null;
  view: ScanQrLookupView;
  scanned: (handle: string) => void;
  pick: (row: ScanQrLookupRow) => void;
  dismiss: () => void;
  /**
   * Clear / Cancel / Save done / next photo / edit start / Import: forget everything, drop any answer on its way.
   * Returns true when the lookup had WRITTEN details into the form (read at call time, never from an old render).
   */
  reset: () => boolean;
  /**
   * Save pressed: an answer still on its way is dropped (it never lands on this or the next parcel).
   * If one was on its way, the form says Customers could not be checked (so a failed save never looks like "no record").
   */
  drop: () => void;
}

const blank = (f: LookupFields): boolean => f.name.trim() === "" && f.phone.trim() === "" && f.store.trim() === "";

export function useScanQrLookup(opts: ScanQrLookupOpts): ScanQrLookupApi {
  const [mark, setMarkState] = useState<ScanQrLookupMark | null>(() => (opts.on ? opts.initial : null));
  const markRef = useRef<ScanQrLookupMark | null>(mark);
  // the username whose lookup could not be read (error / no signal / too slow) — one short line, never kept with the draft
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failedRef = useRef<string | null>(null);
  const setFailed = useCallback((v: string | null) => { if (failedRef.current !== v) { failedRef.current = v; setFailedFor(v); } }, []);
  const seqRef = useRef(0);
  const flightRef = useRef<string | null>(null); // the username of a lookup whose answer has not come yet
  const aliveRef = useRef(true);
  const optsRef = useRef(opts);
  const fieldsRef = useRef(opts.fields);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // After every render: the latest callbacks and the form as it really is.
  useEffect(() => { optsRef.current = opts; fieldsRef.current = opts.fields; });

  const setMark = useCallback((next: ScanQrLookupMark | null) => {
    const v = next && (next.applied || next.pending) ? next : null;
    markRef.current = v;
    setMarkState(v);
  }, []);

  const write = useCallback((row: ScanQrLookupRow, handle: string, how: "auto" | "picked") => {
    // Only what the record really has: an empty value in the record never blanks something the seller typed.
    // But when the form still holds details of ANOTHER username's record, the whole record replaces them
    // (an empty value blanks the field) — nothing of the other buyer may stay under a "Found" box.
    const other = markRef.current?.applied ?? null;
    const whole = other !== null && other.handle !== handle;
    const patch: Partial<LookupFields> = {};
    if (whole || row.name.trim() !== "") patch.name = row.name;
    if (whole || row.phone.trim() !== "") patch.phone = row.phone;
    if (whole || row.storeId.trim() !== "") patch.store = row.storeId;
    optsRef.current.setFields(() => patch);
    fieldsRef.current = { ...fieldsRef.current, ...patch };
    setFailed(null);
    setMark({ applied: { handle, updatedAt: row.updatedAt, filled: { name: patch.name ?? "", phone: patch.phone ?? "", store: patch.store ?? "" } }, pending: null });
    optsRef.current.onApplied?.(how);
  }, [setMark, setFailed]);

  const scanned = useCallback((handle: string) => {
    const o = optsRef.current;
    if (!o.on || o.blocked) return;
    const key = lookupKey(handle);
    const seq = ++seqRef.current;
    setFailed(null);
    // B1 — the previous buyer's details the lookup wrote and nobody touched go away first.
    const prev = markRef.current?.applied ?? null;
    const cur = fieldsRef.current;
    const wipe = untouchedFilled(prev, cur);
    if (Object.keys(wipe).length > 0 && prev) {
      const f = prev.filled;
      o.setFields((s) => {
        const out: Partial<LookupFields> = {};
        for (const k of ["name", "phone", "store"] as const) if (f[k] !== "" && s[k] === f[k]) out[k] = "";
        return out;
      });
    }
    const next = { ...cur, ...wipe, handle };
    fieldsRef.current = next;
    // Details the seller edited stay; while they do and the username is another one, the box says whose they were.
    setMark({ applied: prev && prev.handle !== key && !blank(next) ? prev : null, pending: null });
    flightRef.current = null;
    if (!isLookupable(key)) return;
    flightRef.current = key;
    void lookupCustomersByHandle(o.store, key).then((res) => {
      if (!aliveRef.current || seq !== seqRef.current) return; // a newer scan / Save / Clear / leaving the screen
      flightRef.current = null;
      const now = optsRef.current;
      if (!now.on || now.blocked) return;
      const f = fieldsRef.current;
      if (lookupKey(f.handle) !== key) return; // the username in the field is no longer the scanned one
      if (!res.ok) { setFailed(key); return; }
      if (res.rows.length === 0) return; // no record → exactly as before
      if (res.rows.length === 1 && blank(f)) { write(res.rows[0], key, "auto"); return; }
      setMark({ applied: markRef.current?.applied ?? null, pending: { handle: key, rows: res.rows, more: res.more } });
    });
  }, [setMark, setFailed, write]);

  const pick = useCallback((row: ScanQrLookupRow) => {
    const p = markRef.current?.pending;
    if (!p || !p.rows.some((r) => r.id === row.id)) return;
    write(row, p.handle, "picked");
  }, [write]);

  const dismiss = useCallback(() => {
    const m = markRef.current;
    if (m?.pending) setMark({ applied: m.applied, pending: null });
  }, [setMark]);

  const reset = useCallback((): boolean => {
    seqRef.current++;
    flightRef.current = null;
    setFailed(null);
    const wrote = !!markRef.current?.applied;
    if (markRef.current) setMark(null);
    return wrote;
  }, [setMark, setFailed]);

  const drop = useCallback(() => {
    seqRef.current++;
    const key = flightRef.current;
    flightRef.current = null;
    if (key !== null) setFailed(key);
  }, [setFailed]);

  return { mark, view: lookupView(mark, opts.fields.handle, failedFor), scanned, pick, dismiss, reset, drop };
}
