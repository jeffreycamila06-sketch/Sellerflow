// Share helpers for the "Invite friends" card (kept out of the component file so
// fast-refresh stays happy — the .tsx only exports the component).

// Landing (the store-badge router), NOT a store deep-link.
export const INVITE_URL = "https://sellerflowlive.com";

// Clipboard write with a legacy execCommand fallback. Returns true only on a
// real success (so the "copied" confirmation never lies).
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
