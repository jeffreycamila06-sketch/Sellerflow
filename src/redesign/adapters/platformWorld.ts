// PLATFORM WORLDS — each platform is its own "world": a seller sees only the functions that
// work on the platforms they use. Sits NEXT TO market.ts (region decides which functions
// exist, plan decides how many, the world decides which platform's functions show). It
// only HIDES: every caller does `existingGate && !platformHides(feature, world)`, so it can
// never reveal what marketHides / fbUiGates / igEnabled / shopeeEnabled / a plan gate hides.
// Visibility only — no connect, comment, order, numbering or print logic reads it. PURE.
import { isAdminRole } from "../../lib/roles";

export type Platform = "tiktok" | "facebook" | "instagram" | "shopee";
export type PlatformCounts = Record<Platform, number>;

// GATE: admins (via "View as platform") only for now. Flip to roll out to sellers.
export const PLATFORM_WORLDS_PUBLIC = false;

export type PlatformViewAs = "all" | "tiktok" | "facebook" | "instagram" | "shopee" | "tiktok+facebook";
export const PLATFORM_VIEW_AS_OPTIONS: PlatformViewAs[] = ["all", "tiktok", "facebook", "instagram", "shopee", "tiktok+facebook"];
export const PLATFORM_VIEW_AS_LABEL: Record<Exclude<PlatformViewAs, "all">, string> = {
  tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", shopee: "Shopee", "tiktok+facebook": "TikTok+Facebook",
};

export interface World { used: ReadonlySet<Platform>; known: boolean; adminUnion: boolean }

// Tonight's features → the platform each one needs. Settings → Channels rows are DOORS
// (the way to add a platform) and are deliberately NOT here.
export const FEATURE_PLATFORM = {
  ttChip: "tiktok",      // Live header TikTok chip + its dropdown
  pinPrint: "tiktok",    // Settings → Pin to print row
  fbChip: "facebook",    // Live header Facebook chip + its activation / pages dropdown
  fbPill: "facebook",    // Orders "Facebook" filter pill
  minersSplit: "multi",  // Miners platform split card — only for a seller with 2+ platforms
  fbSoldout: "facebook", // F2 sold-out Messenger message (Receipt format section + the send)
  fbWaitlist: "facebook", // F3 Facebook waitlist (Orders section + joining the line)
} as const satisfies Record<string, Platform | "multi">;
export type WorldFeature = keyof typeof FEATURE_PLATFORM;

const UNKNOWN: World = { used: new Set(), known: false, adminUnion: false };

// The EFFECTIVE world for THIS user:
//  • admin      → the union (sees everything) unless previewing via "View as platform".
//  • non-admin  → switch off, or counts not loaded / failed → unknown → hide nothing.
//                 Else a platform is used when it has ≥1 registered account AND (for
//                 Facebook / Instagram / Shopee) it is open for this seller. None → TikTok.
export function effectiveWorld(o: {
  role?: string | null;
  counts?: PlatformCounts | null;
  access: { facebook: boolean; instagram: boolean; shopee: boolean };
  viewAs?: PlatformViewAs;
  isPublic?: boolean;
}): World {
  if (isAdminRole(o.role)) {
    const va = o.viewAs ?? "all";
    if (va === "all") return { used: new Set(), known: true, adminUnion: true };
    return { used: new Set(va.split("+") as Platform[]), known: true, adminUnion: false };
  }
  if (!(o.isPublic ?? PLATFORM_WORLDS_PUBLIC) || !o.counts) return UNKNOWN;
  const c = o.counts;
  const used = new Set<Platform>();
  if (c.tiktok > 0) used.add("tiktok");
  if (c.facebook > 0 && o.access.facebook) used.add("facebook");
  if (c.instagram > 0 && o.access.instagram) used.add("instagram");
  if (c.shopee > 0 && o.access.shopee) used.add("shopee");
  if (used.size === 0) used.add("tiktok");
  return { used, known: true, adminUnion: false };
}

export function platformHides(feature: WorldFeature, w: World): boolean {
  const need: Platform | "multi" = FEATURE_PLATFORM[feature];
  if (need === "multi") return w.known && !w.adminUnion && w.used.size <= 1;
  return w.known && !w.adminUnion && !w.used.has(need);
}
