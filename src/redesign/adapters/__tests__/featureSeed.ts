// Build 10b test helper — the preview allowlists now live in sql/112 (seed rows). Tests pin the
// exact lists against that file and drive the gates through featureAccess (booleans only).
import { readFileSync } from "node:fs";
const SQL = () => readFileSync("sql/112_feature_access.sql", "utf8");
// Exact-match emails seeded for one feature (prefix rows excluded), in file order.
export function seedEmails(feature: string): string[] {
  return [...SQL().matchAll(/\('([a-z0-9_]+)', '([^']+)', (true|false)\)/g)].filter((m) => m[1] === feature && m[3] === "false").map((m) => m[2]);
}
export function seedPrefixes(feature: string): string[] {
  return [...SQL().matchAll(/\('([a-z0-9_]+)', '([^']+)', (true|false)\)/g)].filter((m) => m[1] === feature && m[3] === "true").map((m) => m[2]);
}
