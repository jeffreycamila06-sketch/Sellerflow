// Shopee paste box — the one-line stop reason (2026-11-22, Jeff's approved design).
// The server sends a reason when a Shopee reader stops (platform_status Shopee connected:false).
// This turns it into the box's orange line, in the seller's words:
//   session_end  → "Your Shopee live has ended."
//   unreachable  → "Shopee stopped answering. Tap Connect to try again."
//   restart      → "Shopee was connected on another device."   (never for THIS device's own connect)
//   shutdown     → "Connection was reset. Tap Connect to continue."
//   max_session  → "Shopee live reached the time limit. Tap Connect to continue."
// Any other reason → no line (the pill still turns gray).
//
// "restart" = the server stopped this device's reader because the SAME seller connected again.
// When THIS device sent that connect, it is its own restart: the server sends the stop of the old
// reader while the request is under way, so a stop heard from the request's start until
// OWN_RESTART_GRACE_MS after its answer counts as our own (the socket can deliver it a little
// after the HTTP answer). Outside that window it was another device.
import type { ShopeeStop } from "./useLiveFeed";

export const OWN_RESTART_GRACE_MS = 15_000;

export const SHOPEE_STOP_KEY: Readonly<Record<string, string>> = {
  session_end: "rd_sh_stop_ended",
  unreachable: "rd_sh_stop_unreachable",
  restart: "rd_sh_stop_other_device",
  shutdown: "rd_sh_stop_reset",
  max_session: "rd_sh_stop_time_limit",
};

/** This device's last /shopee/live/connect request: when it started and when it was answered (ms). */
export interface OwnConnect { startedAt: number | null; endedAt: number | null }

export function isOwnRestart(at: number, own: OwnConnect): boolean {
  if (own.startedAt == null || at < own.startedAt) return false;
  return own.endedAt == null || at - own.endedAt <= OWN_RESTART_GRACE_MS;
}

/** The i18n key of the box's stop line, or null for no line. */
export function shopeeStopNoteKey(stop: ShopeeStop | null, own: OwnConnect): string | null {
  if (!stop) return null;
  if (stop.reason === "restart" && isOwnRestart(stop.at, own)) return null;
  return Object.prototype.hasOwnProperty.call(SHOPEE_STOP_KEY, stop.reason) ? SHOPEE_STOP_KEY[stop.reason] : null;
}
