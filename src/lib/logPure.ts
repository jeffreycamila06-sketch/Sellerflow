// The logger call names the production build treats as side-effect free (removed together with
// their arguments) — see src/lib/log.ts. `devLog` = the alias used where `log` is a local name.
export const LOG_PURE_NAMES = ["log", "devLog"].flatMap((n) => ["log", "info", "warn", "error", "debug"].map((m) => `${n}.${m}`));
