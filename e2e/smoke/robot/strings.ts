// The app's own English (and Tagalog) wording, read from the app's i18n file — so the robot
// looks for the exact words a seller sees, and follows any wording change automatically.
import { buildT } from "../../../src/redesign/i18n";

export const EN = buildT("en") as unknown as Record<string, string>;
export const FIL = buildT("fil") as unknown as Record<string, string>;
