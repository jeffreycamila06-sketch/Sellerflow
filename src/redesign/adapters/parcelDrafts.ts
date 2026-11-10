// Parcel Scan bridge (Jeff 2026-11-11, Option A): what the seller typed in the manual entry of
// the 7-11 Parcel Scan or the FamilyMart Parcel Scan, kept per screen while they hop between the
// two with the ⇄ button (or leave and come back), so nothing unsaved is lost.
//
// In memory only (this app session): nothing is written to the database or the device, so it
// can never be exported, saved or mixed into the other store's batch. The two stores never share
// a slot. RedesignApp clears everything when the signed-in user changes (a shared phone never
// shows one seller's typing to another).
import type { BuyerContactPlatform } from "./buyerContact";

export type ParcelDraftStore = "711" | "fm";
export interface ParcelDraft<F> {
  /** The manual-entry fields exactly as typed (7-11: name/phone/store/amount/notes; FM: name/phone/store/amount/username). */
  form: F;
  /** "Buyer has no social handle" was ticked. */
  noHandle: boolean;
  /** The buyer-contact app picked for this parcel. */
  platform: BuyerContactPlatform;
}

const drafts = new Map<ParcelDraftStore, ParcelDraft<unknown>>();

/** The open manual entry of this store, or null (none open / nothing kept). */
export function readParcelDraft<F>(store: ParcelDraftStore): ParcelDraft<F> | null {
  const d = drafts.get(store);
  return d ? (d as ParcelDraft<F>) : null;
}

/** Keep (or with null, forget) this store's open manual entry. The other store is never touched. */
export function writeParcelDraft<F>(store: ParcelDraftStore, draft: ParcelDraft<F> | null): void {
  if (draft) drafts.set(store, { form: { ...draft.form }, noHandle: draft.noHandle, platform: draft.platform });
  else drafts.delete(store);
}

/** Forget both stores' drafts (user change / logout). */
export function clearParcelDrafts(): void {
  drafts.clear();
}

/** The ⇄ button shows only when the seller may use BOTH Parcel Scans (7-11 and FamilyMart). */
export function parcelBridgeVisible(parcelAllowed: boolean, fmScanAllowed: boolean): boolean {
  return parcelAllowed && fmScanAllowed;
}
