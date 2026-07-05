// Batch E (#16) — THE admin-role predicate. The db value is lowercase "admin"
// (seller_profiles.role, checked by adapters) while the redesign display layer
// maps it to the label "Admin" (checked by screens) — two spellings of the same
// question scattered as raw ===. One case-insensitive predicate answers both
// sides; per-site behavior is unchanged for every value that actually occurs
// (parity-tested).

export const isAdminRole = (role: string | undefined | null): boolean =>
  String(role || "").trim().toLowerCase() === "admin";
