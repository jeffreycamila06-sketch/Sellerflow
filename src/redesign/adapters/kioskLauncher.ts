// Kiosk launcher (.bat) download — laptop silent auto-print helper. Generates a
// tiny Windows batch file client-side (Blob, no server, no storage) that opens
// Chrome in --kiosk-printing on a DEDICATED profile so the seller's normal
// Chrome can stay open. WEB-ONLY feature (the card that surfaces it is gated on
// !isAppShell()); this module has no native/DB dependency.
import { isAdminRole } from "../../lib/roles";
import type { AccountUser } from "../../accountDb";

// ── Gating ────────────────────────────────────────────────────────────────────
// While the launcher is limited, these emails see the download (admins always
// do). ONE place — widen or empty this list to open the button to everyone.
export const KIOSK_LAUNCHER_EMAILS = ["googletest@gmail.com"];

export function canSeeKioskLauncher(account: AccountUser | null | undefined): boolean {
  if (!account) return false;
  if (isAdminRole(account.role)) return true;
  const email = String(account.email || "").trim().toLowerCase();
  return KIOSK_LAUNCHER_EMAILS.includes(email);
}

// ── The launcher file ───────────────────────────────────────────────────────
export const KIOSK_LAUNCHER_FILENAME = "SellerFlowLive-Print.bat";

// Windows .bat — CRLF line endings, trailing newline. Tries the three standard
// Chrome install paths, then launches kiosk-printing on a dedicated profile.
export const KIOSK_LAUNCHER_BAT = [
  "@echo off",
  `set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`,
  `if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"`,
  `if not exist %CHROME% set CHROME="%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"`,
  `start "" %CHROME% --kiosk-printing --user-data-dir="%USERPROFILE%\\SFL-Chrome" https://sellerflowlive.com`,
  "",
].join("\r\n");

// Client-side download (Blob + download attribute). No server, no storage.
export function downloadKioskLauncher(): void {
  if (typeof document === "undefined") return;
  try {
    const blob = new Blob([KIOSK_LAUNCHER_BAT], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = KIOSK_LAUNCHER_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 0);
  } catch { /* best-effort — a blocked download must never break Settings */ }
}
