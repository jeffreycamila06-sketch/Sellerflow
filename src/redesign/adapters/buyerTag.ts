// BUYER TAG — OLD / NEW pill next to a commenter (Live feed) and a buyer (Orders). OLD = this
// seller already has this buyer in their own customers list (any time), NEW = not yet. Display
// only: nothing on the order / print path, buyer numbers untouched.
//
// DATA (the Buyer Alert pattern): ONE RPC, buyer_tag_lookup() (sql/102), loaded when the live
// starts and refreshed every 10 min. Each row is an O(1) Set lookup — never a query per comment.
// A buyer's first order in THIS live turns them OLD at the next refresh (no in-session flip).
// No map yet / RPC failed → buyerTagFor() returns null → no pill at all (never a wrong tag).
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { normHandle } from "./buyerAlert";

export const BUYER_TAG_REFRESH_MS = 10 * 60 * 1000;
export type BuyerTagMap = Set<string>; // "<platform>|<key>"
export type BuyerTag = "old" | "new";

export const normName = (n: string | null | undefined): string => String(n ?? "").trim().toLowerCase();
const normPlatform = (p: string | null | undefined): string => String(p ?? "").trim().toLowerCase();

// Same key as sql/102: Facebook → display name; others → handle (one "@" stripped), else name.
export function buyerTagKey(handle: string | null | undefined, name: string | null | undefined, platform: string | null | undefined): string {
  const p = normPlatform(platform);
  if (!p) return "";
  const key = p === "facebook" ? normName(name) : normHandle(handle) || normName(name);
  return key ? `${p}|${key}` : "";
}

export function buyerTagFor(map: BuyerTagMap | null | undefined, handle: string | null | undefined, name: string | null | undefined, platform: string | null | undefined): BuyerTag | null {
  if (!map) return null;
  const k = buyerTagKey(handle, name, platform);
  if (!k) return null;
  return map.has(k) ? "old" : "new";
}

// RPC jsonb { platform: [key, …] } → Set. Anything malformed is dropped, never thrown.
export function parseBuyerTags(data: unknown): BuyerTagMap {
  const out: BuyerTagMap = new Set();
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [p, keys] of Object.entries(data as Record<string, unknown>)) {
    const plat = normPlatform(p);
    if (!plat || !Array.isArray(keys)) continue;
    for (const k of keys) if (typeof k === "string" && k.trim()) out.add(`${plat}|${k.trim().toLowerCase()}`);
  }
  return out;
}

export async function loadBuyerTags(): Promise<BuyerTagMap | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("buyer_tag_lookup");
    return error ? null : parseBuyerTags(data);
  } catch { return null; }
}

// live = a comment source is connected. Loads at live start + every 10 min; keeps the last good
// map (a failed refresh changes nothing). null until the first successful load.
export function useBuyerTags(live: boolean): BuyerTagMap | null {
  const [map, setMap] = useState<BuyerTagMap | null>(null);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const load = async () => { const m = await loadBuyerTags(); if (alive && m) setMap(m); };
    void load();
    const iv = setInterval(() => void load(), BUYER_TAG_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [live]);
  return map;
}
