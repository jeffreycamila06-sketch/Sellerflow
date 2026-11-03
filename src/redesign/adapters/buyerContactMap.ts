// Pickup Status — which platform each buyer's contact is on (v2 items 2 + 3 of the buyer
// contact plan). Built from the seller's OWN scan tables; read-on-open next to the buyer
// names (never blocks the rows), ZERO poll, never written to. Only rows WITH a platform are
// read (NULL = TikTok / legacy, which needs no entry). Newest wins. Paged 500, stop at
// BUYER_CONTACTS_MAX with a one-time log. ANY error → empty maps (the screen then applies
// the "looks like a phone number → never TikTok Open" rule on its own).
//
// Two maps: 7-11 (parcel_scans → parcel_customers) and FamilyMart (fm_parcel_scans →
// fm_parcel_customers). A carrier=fm row looks in the FM map first, a 7-11 row in the 7-11
// map first. Keys: "<normHandle>|<storeId>" (precise) and "<normHandle>".
import { isSupabaseConfigured, supabase } from "../../supabase";
import { log } from "../../lib/log";
import { normHandle } from "./parcelTracking";
import { contactKey, isContactPlatform, lookupContact, type BuyerContactPlatform } from "./buyerContact";

export const BUYER_CONTACTS_CHUNK = 500;
export const BUYER_CONTACTS_MAX = 2000;
export const BUYER_CONTACTS_DAYS = 60;
let capLogged = false;

export type ContactMaps = { s711: Map<string, BuyerContactPlatform>; fm: Map<string, BuyerContactPlatform> };
export const EMPTY_CONTACT_MAPS: ContactMaps = { s711: new Map(), fm: new Map() };

// PURE: fold rows (newest first) into a map — the first platform seen for a key wins.
export function foldContactRows(
  map: Map<string, BuyerContactPlatform>, wanted: Set<string>,
  rows: { handle: string | null | undefined; storeId: string | null | undefined; platform: unknown }[],
): void {
  for (const r of rows) {
    const k = normHandle(r.handle);
    if (!k || !wanted.has(k) || !isContactPlatform(r.platform)) continue;
    const store = String(r.storeId ?? "").trim();
    if (store && !map.has(contactKey(k, store))) map.set(contactKey(k, store), r.platform);
    if (!map.has(k)) map.set(k, r.platform);
  }
}

// PURE: which map a row reads first.
export function contactFor(maps: ContactMaps, handle: string | null | undefined, storeId: string | null | undefined, carrier?: "711" | "fm"): BuyerContactPlatform | null {
  const k = normHandle(handle);
  if (!k) return null;
  const first = carrier === "fm" ? maps.fm : maps.s711;
  const second = carrier === "fm" ? maps.s711 : maps.fm;
  return lookupContact(first, k, storeId) ?? lookupContact(second, k, storeId);
}

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

type Src = { table: string; handleCol: string; dateCol: string; since: boolean };
const SRC_711: Src[] = [
  { table: "parcel_scans", handleCol: "notes", dateCol: "created_at", since: true },
  { table: "parcel_customers", handleCol: "notes", dateCol: "updated_at", since: false },
];
const SRC_FM: Src[] = [
  { table: "fm_parcel_scans", handleCol: "buyer_username", dateCol: "created_at", since: true },
  { table: "fm_parcel_customers", handleCol: "buyer_username", dateCol: "updated_at", since: false },
];

async function readInto(map: Map<string, BuyerContactPlatform>, wanted: Set<string>, me: string, src: Src, sinceIso: string): Promise<void> {
  for (let off = 0; off < BUYER_CONTACTS_MAX; off += BUYER_CONTACTS_CHUNK) {
    let q = supabase!.from(src.table).select(`${src.handleCol}, store_id, contact_platform`)
      .eq("user_id", me).not("contact_platform", "is", null);
    if (src.since) q = q.gte(src.dateCol, sinceIso);
    const { data, error } = await q.order(src.dateCol, { ascending: false }).range(off, off + BUYER_CONTACTS_CHUNK - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Record<string, unknown>[]; // dynamic column list → untyped rows
    foldContactRows(map, wanted, page.map((r) => ({ handle: r[src.handleCol] as string | null, storeId: r.store_id as string | null, platform: r.contact_platform })));
    if (page.length < BUYER_CONTACTS_CHUNK) return;
  }
  if (!capLogged) { capLogged = true; log.warn(`[pickup] buyer contacts: stopped at ${BUYER_CONTACTS_MAX} rows (${src.table})`); }
}

export async function loadBuyerContacts(rows: { handle: string | null | undefined; carrier?: "711" | "fm" }[]): Promise<ContactMaps> {
  const out: ContactMaps = { s711: new Map(), fm: new Map() };
  const wanted = new Set(rows.map((r) => normHandle(r.handle)).filter(Boolean));
  if (!wanted.size || !isSupabaseConfigured || !supabase) return out;
  const anyFm = rows.some((r) => r.carrier === "fm");
  const any711 = rows.some((r) => r.carrier !== "fm");
  try {
    const me = await uid();
    if (!me) return out;
    const sinceIso = new Date(Date.now() - BUYER_CONTACTS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    if (any711) for (const s of SRC_711) await readInto(out.s711, wanted, me, s, sinceIso);
    if (anyFm) for (const s of SRC_FM) await readInto(out.fm, wanted, me, s, sinceIso);
    return out;
  } catch { return { s711: new Map(), fm: new Map() }; }
}
