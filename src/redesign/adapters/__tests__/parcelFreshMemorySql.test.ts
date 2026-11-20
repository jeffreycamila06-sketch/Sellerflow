// sql/193 (+ rollback) and sql/194 — text pins (Jeff, Nov 21 2026: never tell a seller "no" from an old
// remembered answer). The behaviour itself — the live text md5s, every duration, backup = extension, the
// rollback byte for byte, sql/194's six parcels — is proven on a throw-away database by
// scripts/sql193-behaviour.mjs (PGlite); these pins catch an edit of the files that the script would only
// see when someone runs it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const sqlDir = "sql/";
const read = (f: string) => readFileSync(sqlDir + f, "utf8");
const FILE = read("193_parcel_check_fresh_memory.sql");
const BACK = read("193_parcel_check_fresh_memory_rollback.sql");
const ONE = read("194_parcel_check_recheck_old_no.sql");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
// one function definition: from "CREATE OR REPLACE FUNCTION public.<name>(" to its closing "$function$;"
const fn = (s: string, name: string) => {
  const at = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) return "";
  return s.slice(at, s.indexOf("$function$;", s.indexOf("$function$", at) + 10) + "$function$;".length);
};
const CHANGED = ["admin_parcel_checks_pending", "pc711_backup_pending_rows", "admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows", "parcel_scans_frozen_instant"];
const GATE = ["if not public.is_admin() then raise exception 'forbidden'; end if;", "if not public.pc711_backup_on_duty() then return; end if;"];
const constant = (body: string, name: string) => (new RegExp(`\\b${name}\\s+constant interval := interval '([^']+)';`).exec(body) || [])[1];

describe("sql/193 — the files", () => {
  it("are number 193 (+ rollback) and 194; no other file uses those numbers; NOT applied", () => {
    expect(readdirSync(sqlDir).filter((f) => /^19[34]_/.test(f)).sort()).toEqual([
      "193_parcel_check_fresh_memory.sql", "193_parcel_check_fresh_memory_rollback.sql", "194_parcel_check_recheck_old_no.sql",
    ]);
    expect(FILE).toMatch(/NOT APPLIED/);
    expect(ONE).toMatch(/NOT APPLIED/);
  });
  it("one transaction with a lock limit, and a guard that refuses an unexpected function", () => {
    for (const s of [FILE, BACK]) {
      expect(code(s)).toMatch(/^begin;\nset local lock_timeout = '2s';/m);
      expect(code(s).trim().endsWith("commit;")).toBe(true);
      expect(code(s)).toContain("is not the text this file was made from — nothing was changed");
      for (const n of CHANGED) expect(s).toMatch(new RegExp(`\\('${n}', '[0-9a-f]{32}', '[0-9a-f]{32}'\\)`));
    }
  });
  it("changes exactly the five functions — nothing else is created, dropped or granted", () => {
    const made = [...code(FILE).matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    expect(made).toEqual(CHANGED);
    expect([...code(BACK).matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map((m) => m[1])).toEqual(CHANGED);
    for (const s of [FILE, BACK]) {
      expect(code(s)).not.toMatch(/\b(drop|grant|revoke|alter|create table|create trigger|insert into public\.app_settings|update public\.app_settings)\b/i);
    }
  });
});

describe("sql/193 — the new durations", () => {
  it("store / phone: a remembered answer is copied only when ≤ 5 minutes old; own 'full' asked again after 15 minutes", () => {
    for (const n of ["admin_parcel_checks_pending", "pc711_backup_pending_rows"]) {
      const b = fn(FILE, n);
      expect(constant(b, "v_ok_ttl")).toBe("5 minutes");
      expect(constant(b, "v_store_full_ttl")).toBe("5 minutes");
      expect(constant(b, "v_store_open_ttl")).toBe("5 minutes");
      expect(constant(b, "v_store_fixed_ttl")).toBe("5 minutes");
      expect(constant(b, "v_store_recheck_ttl")).toBe("15 minutes");
      // the re-ask uses the 15 minutes (both conditions), the copy uses the 5 minutes
      expect(b).toContain("       and ps.store_full_at < now() - v_store_recheck_ttl\n");
      expect(b).toContain("       and (c.checked_at is null or c.checked_at < now() - v_store_recheck_ttl)\n");
      expect(b).toContain("(c.status = 'full' and c.checked_at > now() - v_store_full_ttl)");
      expect(b.split("v_store_recheck_ttl").length - 1).toBe(3); // declared once, used twice
    }
  });
  it("phone restricted: UNCHANGED (copied until its restriction date)", () => {
    const rule = "( (c.status = 'restricted' and c.restricted_until is not null\n             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)";
    for (const n of ["admin_parcel_checks_pending", "pc711_backup_pending_rows"]) {
      expect(fn(FILE, n)).toContain(rule);
      expect(fn(BACK, n)).toContain(rule);
    }
  });
  it("frozen ok / no_frozen: 5 minutes in the pending read AND on save; the 10-minute gap, retry and 24-hour late check stay", () => {
    for (const n of ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows"]) {
      const b = fn(FILE, n);
      expect(constant(b, "v_no_ttl")).toBe("5 minutes");
      expect(constant(b, "v_ok_ttl")).toBe("5 minutes");
      expect(constant(b, "v_floor")).toBe("10 minutes");
      expect(constant(b, "v_retry")).toBe("10 minutes");
      expect(constant(b, "v_late")).toBe("24 hours");
    }
    const t = fn(FILE, "parcel_scans_frozen_instant");
    expect(constant(t, "v_no_ttl")).toBe("5 minutes");
    expect(constant(t, "v_ok_ttl")).toBe("5 minutes");
  });
  it("no long memory is left anywhere in 193 (only the 24-hour late check of exported frozen parcels)", () => {
    const longs = [...code(FILE).matchAll(/interval '(\d+) (hours?|days?)'/g)].map((m) => m[0]);
    expect(longs).toEqual(["interval '24 hours'", "interval '24 hours'"]);
  });
  it("the rollback holds the live values", () => {
    for (const n of ["admin_parcel_checks_pending", "pc711_backup_pending_rows"]) {
      const b = fn(BACK, n);
      expect([constant(b, "v_ok_ttl"), constant(b, "v_store_full_ttl"), constant(b, "v_store_open_ttl"), constant(b, "v_store_fixed_ttl")]).toEqual(["6 hours", "1 hour", "10 minutes", "24 hours"]);
      expect(b).not.toContain("v_store_recheck_ttl");
    }
    for (const n of ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows", "parcel_scans_frozen_instant"]) {
      const b = fn(BACK, n);
      expect([constant(b, "v_no_ttl"), constant(b, "v_ok_ttl")]).toEqual(["30 days", "1 hour"]);
    }
  });
  it("the server backup's functions = the extension's, line for line, except the duty check", () => {
    const body = (s: string, n: string) => fn(s, n).slice(fn(s, n).indexOf("AS $function$"));
    for (const s of [FILE, BACK]) {
      for (const [orig, copy] of [["admin_parcel_checks_pending", "pc711_backup_pending_rows"], ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows"]]) {
        expect(body(s, orig).split(GATE[0]).length).toBe(2);
        expect(body(s, copy)).toBe(body(s, orig).replace(GATE[0], GATE[1]));
      }
    }
  });
  it("193 = the rollback with only the duration lines changed", () => {
    const strip = (s: string) => code(s).replace(/do \$guard\$[\s\S]*?end \$guard\$;/, "");
    const a = strip(BACK).split("\n"), b = strip(FILE).split("\n");
    const removed = a.filter((l) => !b.includes(l)), added = b.filter((l) => !a.includes(l));
    expect(removed.every((l) => /constant interval := interval|now\(\) - v_store_full_ttl$|now\(\) - v_store_full_ttl\)$/.test(l))).toBe(true);
    expect(added.every((l) => /constant interval := interval|now\(\) - v_store_recheck_ttl\)?$/.test(l))).toBe(true);
    expect(b.length - a.length).toBe(2); // the new v_store_recheck_ttl line in each of the two dry functions
  });
});

describe("sql/194 — the one-time re-check", () => {
  const c = code(ONE);
  it("selects by rule, never by id", () => {
    expect(ONE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    expect(c.match(/ps\.status <> 'exported'/g)?.length).toBe(3);                 // preview + both updates
    expect(c.match(/exists \(select 1 from public\.parcel_check_access a where a\.user_id = ps\.user_id and a\.enabled\)/g)?.length).toBe(3);
    expect(c.match(/< now\(\) - interval '5 minutes'/g)?.length).toBe(5);         // 3 in the preview + 2 in the updates
  });
  it("empties only store company / not_found and frozen no_frozen — never phone, never full / open / ok", () => {
    expect(c).toContain("set store_full_status = null, store_full_at = null");
    expect(c).toContain("and ps.store_full_status in ('company', 'not_found')");
    expect(c).toContain("set frozen_store_status = null");
    expect(c).toContain("and ps.frozen_store_status = 'no_frozen'");
    expect(c).not.toMatch(/phone_check_status\s*=|phone_restricted_until\s*=|frozen_store_checked_at\s*=|'full'|'open'/);
    expect(c).not.toMatch(/\b(delete|drop|insert)\b/i);
  });
  it("one transaction after the read-only preview", () => {
    expect(c.indexOf("select\n")).toBeLessThan(c.indexOf("begin;"));
    expect(c).toMatch(/begin;\nset local lock_timeout = '2s';\ndo \$recheck\$/);
    expect(c.trim().endsWith("commit;")).toBe(true);
  });
});
