// Kiosk command (laptop silent auto-print helper). The seller PASTES this into
// Win+R (or a Desktop shortcut) to open Chrome in --kiosk-printing on a DEDICATED
// profile so their normal Chrome can stay open. A pasted command has NO file, so
// Windows 11 Smart App Control / SmartScreen never blocks it (a downloaded .bat
// is flagged "may be unsafe"). WEB-ONLY feature (the card is gated on
// !isAppShell()); no native/DB dependency.
import { isAdminRole } from "../../lib/roles";
import type { AccountUser } from "../../accountDb";

// ── Gating ────────────────────────────────────────────────────────────────────
// While the helper is limited, these emails see the button (admins always do).
// ONE place — widen or empty this list to open it to everyone.
export const KIOSK_LAUNCHER_EMAILS = ["googletest@gmail.com"];

export function canSeeKioskLauncher(account: AccountUser | null | undefined): boolean {
  if (!account) return false;
  if (isAdminRole(account.role)) return true;
  const email = String(account.email || "").trim().toLowerCase();
  return KIOSK_LAUNCHER_EMAILS.includes(email);
}

// ── The command (single source of truth; unit-test-pinned) ────────────────────
// Windows: pasted into Win+R / a Desktop shortcut. `chrome` resolves via the App
// Paths registry key Chrome installs, so no full path is needed.
export const KIOSK_COMMAND_WINDOWS = `chrome --kiosk-printing --user-data-dir="%USERPROFILE%\\SFL-Chrome" https://sellerflowlive.com`;
// Mac: run in Terminal.
export const KIOSK_COMMAND_MAC = `open -na "Google Chrome" --args --kiosk-printing --user-data-dir="$HOME/SFL-Chrome" https://sellerflowlive.com`;
