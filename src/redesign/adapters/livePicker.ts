// LIVE PLATFORM PICKER — a new LOOK for the Live dashboard's source chips (presentation
// only). Before connecting: four large tiles (TikTok / Facebook / Instagram / Shopee);
// after connecting: ONE full-width button in the header. Every control calls the SAME
// Dashboard callbacks the classic chips call — nothing here touches connect, session,
// comment, order or print logic.
//
// GATE: admins only for now. Widen later by flipping LIVE_PICKER_PUBLIC (one constant).
export const LIVE_PICKER_PUBLIC = false;

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

// classic = the old chip row (gate off, or 2+ sources connected/connecting)
// picker  = the four tiles replace the empty comments card (State A / B)
// body    = normal body (the board has comments, nothing live) + "Choose live source"
// connected = one source live/connecting → the full-width header button (State C)
export type LivePickerView =
  | { view: "classic" }
  | { view: "picker" }
  | { view: "body" }
  | { view: "connected"; platform: "TikTok" | "Facebook" | "Shopee" };

type Flags = { connected: boolean; connecting: boolean };
export function livePickerView(o: {
  enabled: boolean;
  tt: Flags; fb: Flags; sh: Flags;
  hasComments: boolean;
  chosen: PickerPlatform | null;
}): LivePickerView {
  if (!o.enabled) return { view: "classic" };
  const active = ([["TikTok", o.tt], ["Facebook", o.fb], ["Shopee", o.sh]] as const)
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
