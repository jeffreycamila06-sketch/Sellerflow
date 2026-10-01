// MULTI-SELLER STORE/PHONE CHECK (2026-09-27) — client half. Sellers store
// their own 賣貨便 GM id + phone (seller_myship_config, sql/53); the owner's
// Chrome extension consumes a FAIR cross-seller queue via admin RPCs and every
// check uses the row owner's OWN GM (attribution enforced in the pending RPC's
// INNER JOIN — see sql/53). This module owns: the dogfood allowlist, the GM
// input parsing, config load/save, and the Render-side GM validation call.
import { supabase, isSupabaseConfigured } from "../../supabase";
import { SERVER } from "./serverIdentity";

// ── DOGFOOD GATE (the PIN_PRINT pattern: allowlist + admins; NOT a plan
//    check). RELEASE TO PUBLIC = flip PARCEL_CHECK_PUBLIC to true (one line);
//    instant revert = flip back. Exact list per the owner 2026-09-27 — NO
//    budgetukay* prefix this time (deliberate). ──
export const PARCEL_CHECK_PUBLIC = false;
export const PARCEL_CHECK_PREVIEW_EMAILS: string[] = [
  "googletest@gmail.com",
  "googletest@sellerflowlive.com",
  "ukaydaily1@gmail.com",          // UkayDaily1 (Pro) — dogfood 2026-09-27
  "sanggalanglhea@gmail.com",      // Lhey — added 2026-09-28
  "h0kmming@yahoo.com.tw",         // added 2026-09-28 (h + zero, not letter O)
  "details2ndserve@gmail.com",     // added 2026-09-29
  "chungmaychilleann@gmail.com",   // added 2026-10-01
  "choletrada1022@gmail.com",      // added 2026-10-01
  "bertongpatag@gmail.com",        // added 2026-10-01
  "jaszhu127@gmail.com",           // added 2026-10-01
  "ganggang0958@yahoo.com",        // Now & Wow Closet — added 2026-10-01
];
export function parcelCheckAllowed(email: string | undefined | null, role?: string | null): boolean {
  if (PARCEL_CHECK_PUBLIC) return true;
  if (String(role || "").trim().toLowerCase() === "admin") return true;
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && PARCEL_CHECK_PREVIEW_EMAILS.includes(e);
}

// ── GM input parsing: the seller pastes their shop link
//    (myship.7-11.com.tw/cart/easy/GM… — with/without protocol/www, trailing
//    junk) OR the bare GM id. Canonical form = uppercase "GM" + digits. ──
export function parseGmId(input: string | null | undefined): string | null {
  const s = String(input || "").trim();
  if (!s) return null;
  // URL form: the GM must come from the REAL myship host's path — a substring
  // test is spoofable by putting the host text in another site's path (audit
  // MEDIUM-1), so parse with URL and compare the hostname exactly.
  if (/^https?:\/\//i.test(s) || s.includes("/")) {
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      if (u.hostname.toLowerCase() !== "myship.7-11.com.tw") return null;
      const m = u.pathname.match(/^\/cart\/easy\/GM(\d{8,20})\/?$/i);
      return m ? `GM${m[1]}` : null;
    } catch {
      return null;
    }
  }
  const m = s.match(/^GM(\d{8,20})$/i);
  return m ? `GM${m[1]}` : null;
}

// The 7-11 shipping phone rule (matches the waybill validator): 09 + 8 digits.
export function validOrdMobile(raw: string | null | undefined): boolean {
  return /^09\d{8}$/.test(String(raw || "").trim());
}

export interface MyshipConfig { gmId: string; ordMobile: string; shopName: string | null; verifiedAt: string | null }

export async function loadMyshipConfig(): Promise<MyshipConfig | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.from("seller_myship_config")
    .select("gm_id, ord_mobile, shop_name, verified_at").maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    gmId: String(r.gm_id || ""), ordMobile: String(r.ord_mobile || ""),
    shopName: r.shop_name == null ? null : String(r.shop_name),
    verifiedAt: r.verified_at == null ? null : String(r.verified_at),
  };
}

// H4 (Oct 1 audit): the Parcel Scan banner needs to tell "no row" apart from
// "couldn't read" — loadMyshipConfig folds both into null. A read error is
// FAIL-OPEN at the caller (no banner, checks assumed on): a flaky read must
// never nag a configured seller, and it never blocks Parcel Scan either way.
export async function probeMyshipConfig(): Promise<"configured" | "missing" | "error"> {
  if (!isSupabaseConfigured || !supabase) return "error";
  try {
    const { data, error } = await supabase.from("seller_myship_config").select("gm_id").maybeSingle();
    if (error) return "error";
    return data && (data as { gm_id?: unknown }).gm_id ? "configured" : "missing";
  } catch {
    return "error";
  }
}

// GM-only now: the check uses the shared CHECK_SENDER_PHONE, never a per-seller
// phone, so ord_mobile is always written NULL (column kept, unused; eligibility
// is gm_id-only). shopName undefined = don't touch shop_name/verified_at.
export async function saveMyshipConfig(gmId: string, shopName?: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user?.id;
  if (!uid) return { ok: false, error: "not signed in" };
  const row: Record<string, unknown> = {
    user_id: uid, gm_id: gmId, ord_mobile: null, updated_at: new Date().toISOString(),
  };
  if (shopName !== undefined) { row.shop_name = shopName; row.verified_at = shopName ? new Date().toISOString() : null; }
  const { error } = await supabase.from("seller_myship_config").upsert(row, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// GM validation goes through Render (CORS blocks browser-direct to myship —
// probe-verified; and the sellers entering GMs don't run the extension).
// VERIFY-OPTIONAL by design: a Render failure returns unreachable and the
// caller saves anyway with an honest "unverified" badge — a datacenter-IP
// block at 7-11 must never stall dogfood.
export async function validateGm(gmId: string): Promise<{ ok: true; shopName: string } | { ok: false; invalid?: boolean; unreachable?: boolean }> {
  try {
    if (!supabase) return { ok: false, unreachable: true };
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) return { ok: false, unreachable: true };
    const r = await fetch(`${SERVER}/myship/validate-gm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gmId }),
    });
    if (!r.ok) return { ok: false, unreachable: true };
    const j = (await r.json()) as { valid?: boolean; shopName?: string };
    if (j.valid && j.shopName) return { ok: true, shopName: String(j.shopName) };
    return { ok: false, invalid: true };
  } catch {
    return { ok: false, unreachable: true };
  }
}
