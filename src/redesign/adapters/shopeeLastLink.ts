// Shopee paste box — the last link this seller connected, remembered on this device (2026-11-22).
// After a server restart / deploy the seller would otherwise go back to the Shopee app to copy the
// link again mid-live; now the box opens with it plus the note "Last link used. Paste a new one for a
// new live."
//
//   saved   — after a connect the server accepted (ok)
//   cleared — the server says the live ended (stop reason session_end), a connect answers "ended",
//             or the seller signs out (or deletes the account)
//   kept    — every other stop (unreachable, another device, reset, time limit, socket loss)
//
// The key carries the signed-in seller's id, so a phone or laptop shared by two sellers never shows
// one seller's link to the other. Browser storage can be blocked / full / throw: every read and write
// is wrapped, and a failed read is simply "no saved link".
import { useState } from "react";

export const SHOPEE_LAST_LINK_PREFIX = "sfl_rd_shopee_last_link:";
export const SHOPEE_LAST_LINK_MAX = 500; // a share link is ~30–120 characters; never store more than this

export const lastLinkKey = (uid: string): string => `${SHOPEE_LAST_LINK_PREFIX}${uid}`;

export function readLastLink(uid: string): string {
  if (!uid) return "";
  try {
    const v = localStorage.getItem(lastLinkKey(uid));
    return typeof v === "string" && v.length <= SHOPEE_LAST_LINK_MAX ? v.trim() : "";
  } catch { return ""; }
}
export function saveLastLink(uid: string, link: string): void {
  const v = String(link || "").trim();
  if (!uid || !v || v.length > SHOPEE_LAST_LINK_MAX) return;
  try { localStorage.setItem(lastLinkKey(uid), v); } catch { /* storage blocked — kept in memory only */ }
}
export function clearLastLink(uid: string): void {
  if (!uid) return;
  try { localStorage.removeItem(lastLinkKey(uid)); } catch { /* nothing to clear */ }
}

export interface ShopeeLastLink { link: string; save: (link: string) => void; clear: () => void }

/** The signed-in seller's saved link (state follows the user id; another seller never sees it). */
export function useShopeeLastLink(uid: string): ShopeeLastLink {
  const [st, setSt] = useState(() => ({ uid, link: readLastLink(uid) }));
  if (st.uid !== uid) setSt({ uid, link: readLastLink(uid) }); // adjust-during-render on a user switch
  const link = st.uid === uid ? st.link : "";
  return {
    link,
    save: (l: string) => {
      const v = String(l || "").trim();
      if (!uid || !v || v.length > SHOPEE_LAST_LINK_MAX) return;
      saveLastLink(uid, v);
      setSt({ uid, link: v });
    },
    clear: () => { clearLastLink(uid); setSt({ uid, link: "" }); },
  };
}
