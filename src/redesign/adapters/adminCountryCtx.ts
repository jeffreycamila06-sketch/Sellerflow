// Shared pieces for the admin-only country label (components/AdminCountry.tsx).
// Texts are the owner's own Tagalog wording (the approved preview); admin-only, so they
// are not in the seller translation tables.
import { createContext } from "react";
import type { ResolvedCountry } from "./adminCountry";

export const ACT = {
  unknown: "Hindi alam",
  title: "Piliin ang bansa",
  search: "I-type ang bansa",
  frequent: "MADALAS",
  results: "RESULTA",
  save: "I-save",
  auto: "Ibalik sa automatic",
  close: "Isara",
  none: "Walang nahanap",
  hint: "Mapapalitan mo rin ito anytime, kahit nahulaan ng system.",
  saveErr: "Hindi na-save. Subukan ulit.",
  srcAdmin: "pinili mo",
  srcSaved: "galing sa sign-up",
  srcPhone: "hula mula sa phone number",
  now: "Ngayon",
} as const;

// Provided by AdminPanel; null outside it → the pills render nothing.
export interface CountryInfo extends ResolvedCountry { userId: string; email: string }
export interface AdminCountryApi { infoFor: (email: string | null | undefined) => CountryInfo | null; open: (email: string) => void }
export const AdminCountryCtx = createContext<AdminCountryApi | null>(null);
