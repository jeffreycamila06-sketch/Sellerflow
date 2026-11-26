// LIVE PLATFORM PICKER — a new LOOK for the Live dashboard's source chips (presentation
// only). Before connecting: four large tiles (TikTok / Facebook / Instagram / Shopee);
// after connecting: ONE full-width button in the header. Every control calls the SAME
// Dashboard callbacks the classic chips call — nothing here touches connect, session,
// comment, order or print logic.
//
// GATE: Build 14 (Jeff, approved Oct 8) — every seller. Admins had it first; false puts
// every non-admin back on the classic chips (one constant).
export const LIVE_PICKER_PUBLIC = true;

export function livePickerEnabled(isAdmin: boolean): boolean {
  return LIVE_PICKER_PUBLIC || isAdmin === true;
}

// MOTION — every duration and the idle mode in one place (applied as CSS variables).
//   always = idle emblem/name animations loop while the four tiles are shown and no tile
//            is chosen; once = each idle animation runs 2 iterations; off = none.
// prefers-reduced-motion: reduce (and the app's motion kill switch) → no animation, no
// transition, regardless of this setting.
export type LivePickerMotion = "always" | "once" | "off";
export const LIVE_PICKER_MOTION: LivePickerMotion = "always";
export const LIVE_PICKER_ONCE_ITERATIONS = 2;
export const LIVE_PICKER_TIMING = {
  fadeMs: 750,          // the other three tiles fade out
  collapseMs: 450,      // …then collapse (height + margin)
  collapseDelayMs: 700, // …starting after this
  popMs: 300,           // the account panel pops in
  popDelayMs: 1250,     // …this long after the tap
  flyMs: 650,           // the connected source flies up into the header
  blinkMs: 1200,        // the LIVE tag's red dot
  idle: { TikTok: 1700, Facebook: 2800, Instagram: 3200, Shopee: 3800 },
} as const;

export type PickerPlatform = "TikTok" | "Facebook" | "Instagram" | "Shopee";
export const PICKER_ORDER: PickerPlatform[] = ["TikTok", "Facebook", "Instagram", "Shopee"];

// THE EMBLEMS (components/PlatformEmblem.tsx): one shape per platform, the chip's own letter mark and
// brand colour. Shared by the Live picker's tiles and Settings → Invoicing's tab bar.
export const EMBLEM_SLUG: Record<PickerPlatform, string> = { TikTok: "tt", Facebook: "fb", Instagram: "ig", Shopee: "sh" };
export const EMBLEM_BRAND: Record<PickerPlatform, string> = { TikTok: "#000", Facebook: "#1877f2", Instagram: "#c13584", Shopee: "#ee4d2d" };
export const EMBLEM_LETTER: Record<PickerPlatform, string> = { TikTok: "t", Facebook: "f", Instagram: "IG", Shopee: "S" };
/** The colour a platform is OUTLINED with: its brand colour — TikTok's is black, so its outline is the
 *  text colour (black on light, white on dark), the same choice the emblem's own ring makes. */
export const emblemOutline = (p: PickerPlatform): string => (p === "TikTok" ? "var(--text)" : EMBLEM_BRAND[p]);
/** The emblems' idle-motion settings as CSS variables — the same names and values the Live picker sets
 *  (one duration per platform + how many times a loop runs). For anything else that shows the emblems. */
export function emblemMotionVars(): Record<string, string> {
  return {
    "--lpk-tt": `${LIVE_PICKER_TIMING.idle.TikTok}ms`,
    "--lpk-fb": `${LIVE_PICKER_TIMING.idle.Facebook}ms`,
    "--lpk-ig": `${LIVE_PICKER_TIMING.idle.Instagram}ms`,
    "--lpk-sh": `${LIVE_PICKER_TIMING.idle.Shopee}ms`,
    "--lpk-iter": LIVE_PICKER_MOTION === "once" ? String(LIVE_PICKER_ONCE_ITERATIONS) : "infinite",
  };
}

// classic = the old chip row (gate off, or 2+ sources connected/connecting)
// picker  = the four tiles replace the empty comments card (State A / B)
// body    = normal body (the board has comments, nothing live) + "Choose live source"
// connected = one source live/connecting → the full-width header button (State C)
export type LivePickerView =
  | { view: "classic" }
  | { view: "picker" }
  | { view: "body" }
  | { view: "connected"; platform: "TikTok" | "Facebook" | "Shopee" | "Instagram" };

type Flags = { connected: boolean; connecting: boolean };
export function livePickerView(o: {
  enabled: boolean;
  tt: Flags; fb: Flags; sh: Flags;
  ig?: Flags; // Instagram (phase 1) — absent = not live, so every other answer is unchanged
  hasComments: boolean;
  chosen: PickerPlatform | null;
}): LivePickerView {
  if (!o.enabled) return { view: "classic" };
  const active = ([["TikTok", o.tt], ["Facebook", o.fb], ["Shopee", o.sh], ["Instagram", o.ig ?? { connected: false, connecting: false }]] as const)
    .filter(([, f]) => f.connected || f.connecting);
  if (active.length > 1) return { view: "classic" };
  const idle = o.hasComments ? { view: "body" as const } : { view: "picker" as const };
  if (active.length === 1) {
    const [platform, f] = active[0];
    // A source the seller just chose is still connecting → stay on the chosen tile
    // ("Connecting…"). Anything else live/connecting (app open, auto-reconnect) → State C.
    if (!f.connected && o.chosen === platform) return idle;
    return { view: "connected", platform };
  }
  return idle;
}
