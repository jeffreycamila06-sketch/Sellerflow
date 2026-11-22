// Seller Website v4 — who sees the new look (sql/203). ONE database function answers for a shop:
//   true  = the switch app_settings.website_new_look_enabled is 'true', OR the shop is on the test list
//           (app_settings.website_new_look_shops), OR the person looking is a signed-in admin
//   false = everything else — and also when the function is not there yet, the database does not answer,
//           or it takes longer than 2.5 s. False = the shop looks exactly as before.
import { isSupabaseConfigured, supabase } from "../../supabase";

export const NEW_LOOK_WAIT_MS = 2500;
/** Pure: only a real `true` turns the new look on. */
export const isNewLookAnswer = (data: unknown, error: unknown): boolean => !error && data === true;

/** `anyShop`: the seller's editor also asks before the seller has a shop address (then only the switch or an
 *  admin answers true). The shop page never asks without an address. */
export async function loadNewLook(sub: string, anyShop = false): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || (!sub && !anyShop)) return false;
  const db = supabase;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (async () => {
    try { const { data, error } = await db.rpc("website_new_look", { p_sub: sub }); return isNewLookAnswer(data, error); } catch { return false; }
  })();
  const late = new Promise<boolean>((done) => { timer = setTimeout(() => done(false), NEW_LOOK_WAIT_MS); });
  try { return await Promise.race([ask, late]); } finally { if (timer) clearTimeout(timer); }
}
