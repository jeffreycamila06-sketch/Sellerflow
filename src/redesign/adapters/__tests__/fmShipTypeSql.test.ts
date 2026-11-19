// @vitest-environment node
// sql/182 — the saved delivery words of 全家 rows (全家店寄店取 → C2C). The file is NOT applied by
// this branch; the app shows those rows correctly without it. These pins read the two files as
// text; scripts/sql182-behaviour.mjs runs them on a real Postgres (PGlite, not part of CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FM_STORE_PICKUP_SAVED } from "../parcelTracking";
import { FM_STORE_PICKUP } from "../fmPickup";

const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const up = readFileSync("sql/182_fm_ship_type_fix.sql", "utf8");
const down = readFileSync("sql/182_fm_ship_type_fix_rollback.sql", "utf8");
const upCode = strip(up), downCode = strip(down);

describe("sql/182 — 全家店寄店取 → C2C for 全家 rows only", () => {
  it("says it is not applied and names its rollback", () => {
    expect(up).toMatch(/^-- 182 — /);
    expect(up).toContain("NOT APPLIED");
    expect(up).toContain("sql/182_fm_ship_type_fix_rollback.sql");
  });
  it("ONE update, of ship_type only, of 全家 rows whose ship_type is exactly the old words", () => {
    expect(upCode.match(/\bupdate\b/gi)).toHaveLength(1);
    expect(upCode).toMatch(/update public\.parcel_tracking\s+set ship_type = 'C2C'\s+where carrier = 'fm'\s+and ship_type = '全家店寄店取'\s+returning id/);
    expect(upCode).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i);
    expect(upCode).not.toMatch(/set\s+(status|terminal|pickup_deadline|tracking_no|user_id|carrier)\b/i);
  });
  it("the two words are the ones the app uses: what the reader saves, and what it still accepts", () => {
    expect(FM_STORE_PICKUP).toBe("C2C");
    expect([...FM_STORE_PICKUP_SAVED]).toEqual(["C2C", "全家店寄店取"]);
    expect(upCode).toContain(`set ship_type = '${FM_STORE_PICKUP_SAVED[0]}'`);
    expect(upCode).toContain(`ship_type = '${FM_STORE_PICKUP_SAVED[1]}'`);
  });
  it("keeps each changed row's id and old words in a table no browser role can read", () => {
    expect(upCode).toMatch(/create table public\.parcel_tracking_fm_ship_type_182/);
    expect(upCode).toMatch(/alter table public\.parcel_tracking_fm_ship_type_182 enable row level security/);
    expect(upCode).toMatch(/revoke all on table public\.parcel_tracking_fm_ship_type_182 from public, anon, authenticated/);
    expect(upCode).not.toMatch(/create policy/i);
    expect(upCode).toMatch(/insert into public\.parcel_tracking_fm_ship_type_182 \(id, old_ship_type\)\s+select id, '全家店寄店取' from changed/);
  });
  it("one transaction with a lock limit, in both files", () => {
    for (const code of [upCode, downCode]) {
      expect(code.trim().startsWith("begin;")).toBe(true);
      expect(code.trim().endsWith("commit;")).toBe(true);
      expect(code).toContain("set local lock_timeout = '5s';");
    }
  });
  it("the rollback puts back only the rows the file changed (by id, 全家, still C2C) and removes the helper table", () => {
    expect(downCode).toMatch(/update public\.parcel_tracking p\s+set ship_type = b\.old_ship_type\s+from public\.parcel_tracking_fm_ship_type_182 b\s+where p\.id = b\.id\s+and p\.carrier = 'fm'\s+and p\.ship_type = 'C2C'/);
    expect(downCode).toMatch(/drop table public\.parcel_tracking_fm_ship_type_182;/);
    expect(downCode.match(/\bupdate\b/gi)).toHaveLength(1);
    expect(downCode).not.toMatch(/\bdelete\b|\btruncate\b/i);
  });
  it("it is the newest numbered file (no other 182, nothing above it)", async () => {
    const { readdirSync } = await import("node:fs");
    const nums = readdirSync("sql").map((f) => Number(f.match(/^(\d+)_/)?.[1])).filter((x) => Number.isFinite(x));
    expect(Math.max(...nums)).toBe(182);
    expect(readdirSync("sql").filter((f) => f.startsWith("182_")).sort()).toEqual(["182_fm_ship_type_fix.sql", "182_fm_ship_type_fix_rollback.sql"]);
  });
});
