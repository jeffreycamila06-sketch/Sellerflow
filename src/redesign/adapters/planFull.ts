// "Plan full" popup (sql/199, 2026-11-22, Jeff's approved design). ONE popup for every place an account can not
// be added or can not go live: a TikTok name, a Facebook Page, an Instagram account, a Shopee shop, and live start
// with an account outside the plan. Shown ONLY to the preview (feature key account_limits_v2), admins, or everyone
// once shopee_account_enforce is 'true' — accountLimitsV2Visible. Everyone else keeps today's toast / message.
//
// my_account_list() = the seller's own accounts (oldest first, the live rule's order) + the 4-hour lock + the
// server's clock; one small read each time the popup opens. Pure helpers below are unit-tested.
//
// THE 4-HOUR RULE (sql/205, Jeff 2026-11-22 — replaces "every removal waits"): removing an account and adding a
// different one is immediate. The account that took the place is locked for 4 hours (lockUntil): Remove on it
// shows "Wait a little" with the time left instead of removing it. If it is removed another way, its place stays
// used until the 4 hours end (locked / nextFreeAt). The same account back is immediate.
import { supabase } from "../../supabase";
import { tpl, type RedesignT } from "../i18n";
import { unlockInHM } from "./tiktokCooldown";

export type AccountPlatform = "tiktok" | "facebook" | "instagram" | "shopee";
export type PlanFullKind = "tiktok" | "facebook" | "instagram" | "shopee" | "live";
export interface PlanFullTarget {
  kind: PlanFullKind;
  name?: string;                                    // live: the account that could not go live
  wait?: { nextFreeAt: string | null; serverNow: string | null; receivedAt: number }; // the server already said "wait" (receivedAt = this device's ms when the answer came)
}
export interface AccountRow { platform: AccountPlatform; key: string; id: string | null; name: string | null; link: boolean; rank: number; covered: boolean; addedAt: string | null; lockUntil: string | null }
export interface AccountList { v2: boolean; plan: string; limit: number; unlimited: boolean; used: number; locked: number; nextFreeAt: string | null; serverNow: string | null; loadedAt: number; accounts: AccountRow[] }
export interface LiveAccounts { tiktok: string | null; facebook: string | null; instagram: string | null; shopeeUid: string | null; shopeeShopId: string | null }

/** Who sees the new popup / screens: admins, the preview key, or everyone once the switch is on. */
export function accountLimitsV2Visible(o: { isAdmin: boolean; previewKey: boolean; switchOn: boolean }): boolean {
  return o.isAdmin || o.previewKey || o.switchOn;
}

const PLATFORMS = new Set<AccountPlatform>(["tiktok", "facebook", "instagram", "shopee"]);
const num = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const iso = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
const str = (x: unknown) => (typeof x === "string" && x.trim() ? x : null);

export function parseAccountList(data: unknown, loadedAt: number = Date.now()): AccountList | null {
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.accounts)) return null;
  const accounts: AccountRow[] = [];
  for (const raw of d.accounts as unknown[]) {
    const a = raw as Record<string, unknown>;
    const platform = String(a?.platform || "") as AccountPlatform;
    const key = String(a?.key ?? "").trim();
    if (!PLATFORMS.has(platform) || !key) continue;
    accounts.push({ platform, key, id: str(a.id), name: str(a.name), link: a.link === true, rank: num(a.rank), covered: a.covered !== false, addedAt: iso(a.added_at), lockUntil: iso(a.lock_until) });
  }
  return {
    v2: d.v2 === true, plan: String(d.plan || ""), limit: num(d.limit, 1), unlimited: d.unlimited === true,
    used: num(d.used), locked: num(d.locked), nextFreeAt: iso(d.next_free_at), serverNow: iso(d.now), loadedAt, accounts,
  };
}

export async function loadMyAccountList(): Promise<AccountList | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_account_list");
    if (error) return null;
    return parseAccountList(data);
  } catch {
    return null;
  }
}

/** The TikTok name as the database keys it (trim, leading @ off, lower case — account_tiktok_keys). */
export const tiktokKey = (name: string | null | undefined): string => String(name || "").trim().replace(/^@+/, "").toLowerCase();
/** A paste-link Shopee shop's display: "Shopee shop ·1234" (the last 4 of the host uid). */
export const shopTail = (key: string): string => { const uid = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key; return uid.slice(-4); };

export function accountName(a: AccountRow, t: RedesignT): string {
  if (a.platform === "tiktok") return `@${a.key}`;
  if (a.name) return a.name;
  if (a.platform === "shopee") return tpl(t.rd_pf_shop_name, { tail: shopTail(a.key) });
  if (a.platform === "facebook") return t.rd_pf_plat_facebook;
  return t.rd_pf_plat_instagram;
}
export function platformName(p: AccountPlatform, t: RedesignT): string {
  return p === "tiktok" ? t.rd_pf_plat_tiktok : p === "facebook" ? t.rd_pf_plat_facebook : p === "instagram" ? t.rd_pf_plat_instagram : t.rd_pf_plat_shopee;
}

/** Is this account the one live right now (then the popup says "End your live first" instead of Remove)? */
export function isAccountLive(a: AccountRow, live: LiveAccounts): boolean {
  if (a.platform === "tiktok") return !!live.tiktok && tiktokKey(live.tiktok) === a.key;
  if (a.platform === "facebook") return !!live.facebook && live.facebook === a.key;
  if (a.platform === "instagram") return !!live.instagram && live.instagram === a.key;
  if (a.link) return !!live.shopeeUid && a.key.endsWith(`:${live.shopeeUid}`);
  return !!live.shopeeShopId && live.shopeeShopId === a.key;
}

/** Milliseconds until a held place is free again (a locked account was removed), or null when the refusal is not that wait.
 *  The wait applies when the seller's REAL accounts leave room and only held places fill the plan.
 *  Counted on the SERVER's clock: its time when the answer came + the time this device has counted since. */
export function waitMs(list: AccountList | null, target: PlanFullTarget, deviceNow: number): number | null {
  const fromTarget = !!target.wait?.nextFreeAt;
  const nextFree = fromTarget ? target.wait!.nextFreeAt : (list && list.locked > 0 && list.used - list.locked < list.limit ? list.nextFreeAt : null);
  if (!nextFree) return null;
  const serverNow = fromTarget ? target.wait!.serverNow : list?.serverNow ?? null;
  const receivedAt = fromTarget ? target.wait!.receivedAt : list?.loadedAt ?? deviceNow;
  const serverNowMs = serverNow ? Date.parse(serverNow) + (deviceNow - receivedAt) : deviceNow;
  const ms = Date.parse(nextFree) - serverNowMs;
  return ms > 0 ? ms : null;
}

/** Milliseconds until this account's own 4 hours end (it took a removed account's place), or null when it is not
 *  locked. Same clock as waitMs: the server's time when the list came + what this device has counted since.
 *  Never for a seller without a limit (an admin). */
export function lockMs(a: AccountRow, list: AccountList | null, deviceNow: number): number | null {
  if (!a.lockUntil || !list || list.unlimited) return null;
  const serverNowMs = list.serverNow ? Date.parse(list.serverNow) + (deviceNow - list.loadedAt) : deviceNow;
  const ms = Date.parse(a.lockUntil) - serverNowMs;
  return ms > 0 ? ms : null;
}

export const countdownText = (ms: number, t: RedesignT): string => tpl(t.rd_pf_countdown, unlockInHM(ms));

/** The lead and the note under the list (iPhone: no plan words — App Store rule). */
export function planFullTexts(o: { list: AccountList; target: PlanFullTarget; ios: boolean; planName: string; t: RedesignT }): { title: string; lead: string; note: string } {
  const { list, target, ios, planName, t } = o;
  const one = list.accounts.length <= 1;
  const max = list.limit;
  const head = ios
    ? (max === 1 ? t.rd_pf_lead1_ios : tpl(t.rd_pf_leadn_ios, { max }))
    : (max === 1 ? tpl(t.rd_pf_lead1, { plan: planName }) : tpl(t.rd_pf_leadn, { plan: planName, max }));
  const goal = target.kind === "live"
    ? tpl(t.rd_pf_to_live, { name: target.name || "" })
    : one
      ? (target.kind === "tiktok" ? t.rd_pf_to_tiktok_one : target.kind === "facebook" ? t.rd_pf_to_facebook_one : target.kind === "instagram" ? t.rd_pf_to_instagram_one : t.rd_pf_to_shopee_one)
      : (target.kind === "tiktok" ? t.rd_pf_to_tiktok_many : target.kind === "facebook" ? t.rd_pf_to_facebook_many : target.kind === "instagram" ? t.rd_pf_to_instagram_many : t.rd_pf_to_shopee_many);
  const lock = t.rd_pf_lock_note;
  return {
    title: ios ? t.rd_pf_title_ios : t.rd_pf_title,
    lead: one ? `${head} ${t.rd_pf_this_account}` : `${head} ${goal}`,
    note: one ? `${goal} ${target.kind === "live" ? "" : lock}`.trim() : (target.kind === "live" ? "" : lock),
  };
}

export function waitLead(target: PlanFullTarget, t: RedesignT): string {
  return target.kind === "tiktok" ? t.rd_pf_wait_tiktok : target.kind === "facebook" ? t.rd_pf_wait_facebook : target.kind === "instagram" ? t.rd_pf_wait_instagram : target.kind === "shopee" ? t.rd_pf_wait_shopee : t.rd_pf_wait_any;
}
