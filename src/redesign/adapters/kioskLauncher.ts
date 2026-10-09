// Kiosk command (laptop silent auto-print helper). The seller PASTES this into
// Win+R (or a Desktop shortcut) to open Chrome in --kiosk-printing on a DEDICATED
// profile so their normal Chrome can stay open. A pasted command has NO file, so
// Windows 11 Smart App Control / SmartScreen never blocks it (a downloaded .bat
// is flagged "may be unsafe"). WEB-ONLY feature (the card is gated on
// !isAppShell()); no native/DB dependency.
import { isAdminRole } from "../../lib/roles";
import type { AccountUser } from "../../accountDb";
import { hasFeature } from "./featureAccess";

// ── Gating ────────────────────────────────────────────────────────────────────
// While the helper is limited, listed accounts see the button (admins always do). Build 10b:
// the list lives in the database (sql/112 feature "kiosk_launcher").

export function canSeeKioskLauncher(account: AccountUser | null | undefined): boolean {
  if (!account) return false;
  if (isAdminRole(account.role)) return true;
  const email = String(account.email || "").trim().toLowerCase();
  return email !== "" && hasFeature("kiosk_launcher");
}

// ── The command (single source of truth; unit-test-pinned) ────────────────────
// Windows: pasted into Win+R / a Desktop shortcut. `chrome` resolves via the App
// Paths registry key Chrome installs, so no full path is needed.
export const KIOSK_COMMAND_WINDOWS = `chrome --kiosk-printing --user-data-dir="%USERPROFILE%\\SFL-Chrome" https://sellerflowlive.com`;
// Mac: run in Terminal.
export const KIOSK_COMMAND_MAC = `open -na "Google Chrome" --args --kiosk-printing --user-data-dir="$HOME/SFL-Chrome" https://sellerflowlive.com`;
