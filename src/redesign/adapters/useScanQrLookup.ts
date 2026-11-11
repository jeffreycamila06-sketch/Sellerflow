// Scan QR → fill from Customers, as ONE hook used by BOTH Parcel Scan screens (7-11 and FamilyMart)
// so they can never drift. The screen keeps doing exactly what it does today on a scan (username in
// the field, toast); then it calls scanned(handle) and this hook does the rest. It shows NOTHING:
// either name, phone and store are filled from the newest record of that username, or nothing happens.
//
// `on` false (switch off and login not listed) → scanned() returns at once: no read, no state.
//
// Guards:
//  • a new scan first blanks the details the last fill wrote and nobody touched since (A → B never mixes)
//  • a fill happens only while name, phone and store are ALL still blank
//  • every scan / reset / Save press takes a new number; an answer with an old number is dropped
//  • the username in the field must still be the scanned one when the answer comes
//  • reset() at Clear / Cancel / Save done / next photo / edit start / Import
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isLookupable, lookupCustomersByHandle, lookupKey, untouchedFilled,
  type LookupFields, type ScanQrLookupMark, type ScanQrLookupStore,
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
  /** Name, phone and store were just filled from Customers. */
  onFilled?: () => void;
}
export interface ScanQrLookupApi {
  /** What the last fill wrote (null = nothing). Never shown; travels with this screen's ⇄ draft. */
  mark: ScanQrLookupMark | null;
  scanned: (handle: string) => void;
  /**
   * Clear / Cancel / Save done / next photo / edit start / Import: forget the fill, drop any answer on its way.
   * Returns true when details a fill WROTE are still in the form (read at call time, never from an old render);
   * false when nothing was filled, or the seller has since retyped all of it.
   */
  reset: () => boolean;
  /** Save pressed: an answer still on its way is dropped (it never lands on this or the next parcel). */
  drop: () => void;
}

const blank = (f: LookupFields): boolean => f.name.trim() === "" && f.phone.trim() === "" && f.store.trim() === "";

export function useScanQrLookup(opts: ScanQrLookupOpts): ScanQrLookupApi {
  const [mark, setMarkState] = useState<ScanQrLookupMark | null>(() => (opts.on ? opts.initial : null));
  const markRef = useRef<ScanQrLookupMark | null>(mark);
  const seqRef = useRef(0);
  const aliveRef = useRef(true);
  const optsRef = useRef(opts);
  const fieldsRef = useRef(opts.fields);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // After every render: the latest callbacks and the form as it really is.
  useEffect(() => { optsRef.current = opts; fieldsRef.current = opts.fields; });

  const setMark = useCallback((next: ScanQrLookupMark | null) => {
    if (markRef.current === next) return;
    markRef.current = next;
    setMarkState(next);
  }, []);

  const scanned = useCallback((handle: string) => {
    const o = optsRef.current;
    if (!o.on || o.blocked) return;
    const key = lookupKey(handle);
    const seq = ++seqRef.current;
    // The previous buyer's details that the last fill wrote and nobody touched go away first.
    const prev = markRef.current;
    const cur = fieldsRef.current;
    const wipe = untouchedFilled(prev, cur);
    if (prev && Object.keys(wipe).length > 0) {
      const f = prev.filled;
      o.setFields((s) => {
        const out: Partial<LookupFields> = {};
        for (const k of ["name", "phone", "store"] as const) if (f[k] !== "" && s[k] === f[k]) out[k] = "";
        return out;
      });
    }
    fieldsRef.current = { ...cur, ...wipe, handle };
    setMark(null);
    if (!isLookupable(key)) return;
    void lookupCustomersByHandle(o.store, key).then((res) => {
      if (!aliveRef.current || seq !== seqRef.current) return; // a newer scan / Save / Clear / leaving the screen
      const now = optsRef.current;
      if (!now.on || now.blocked) return;
      const f = fieldsRef.current;
      if (lookupKey(f.handle) !== key) return; // the username in the field is no longer the scanned one
      if (!res.ok || res.rows.length === 0) return; // could not read / no record → exactly as before
      if (!blank(f)) return; // something is typed in name, phone or store → nothing is filled
      const row = res.rows[0]; // the newest record of this username
      const filled: LookupFields = { name: row.name, phone: row.phone, store: row.storeId };
      now.setFields(() => filled);
      fieldsRef.current = { ...f, ...filled };
      setMark({ handle: key, filled });
      now.onFilled?.();
    });
  }, [setMark]);

  const reset = useCallback((): boolean => {
    seqRef.current++;
    const m = markRef.current;
    const wrote = m !== null && Object.keys(untouchedFilled(m, fieldsRef.current)).length > 0;
    setMark(null);
    return wrote;
  }, [setMark]);

  const drop = useCallback(() => { seqRef.current++; }, []);

  return { mark, scanned, reset, drop };
}
