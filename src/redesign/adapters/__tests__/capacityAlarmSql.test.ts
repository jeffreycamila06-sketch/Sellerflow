// sql/215 (server-capacity alarms: server_runs, the switch row, the database-connections alarm) — what the file
// may and may not do, read from the file itself. Behaviour on a real Postgres: scripts/sql215-behaviour.mjs (not in CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ALARM_SWITCH_KEY, RUNS_TABLE, LEVELS } from "../../../../server/capacityAlarm.js";

const read = (f: string) => readFileSync(f, "utf8");
const code = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const up = code(read("sql/215_server_capacity_alarms.sql")), down = code(read("sql/215_server_capacity_alarms_rollback.sql"));

describe("sql/215", () => {
  it("the table the server writes has exactly the columns the server sends, and no browser access", () => {
    const server = read("server/capacityAlarm.js");
    const cols = ["run_id", "started_at", "heartbeat_at", "lives", "mem_pct", "told_level", "commit", "ended_clean_at", "alarmed_at"];
    const table = up.slice(up.indexOf(`create table public.${RUNS_TABLE} (`), up.indexOf("create index server_runs_heartbeat_idx"));
    for (const c of cols) { expect(table, c).toMatch(new RegExp(`\\n\\s+${c}\\s`)); expect(server, c).toContain(c); }
    expect((table.match(/\n\s+[a-z_]+\s+(text|timestamptz|integer|smallint)/g) || []).length).toBe(cols.length);
    expect(table).toContain(`check (told_level in (${LEVELS.map((l) => `'${l}'`).join(",")}))`);
    expect(up).toContain(`alter table public.${RUNS_TABLE} enable row level security;`);
    expect(up).toContain(`revoke all on public.${RUNS_TABLE} from public, anon, authenticated, service_role;`);
    expect(up).toContain(`grant select, insert, update, delete on public.${RUNS_TABLE} to service_role;`);
    expect(up).not.toMatch(/create policy/i);
    expect(up).not.toMatch(/grant [^;]* to (anon|authenticated)/i);
  });
  it("the switch row is created 'true' and never changed if it is already there", () => {
    expect(up).toContain(`insert into public.app_settings (key, value) values ('${ALARM_SWITCH_KEY}', 'true')\non conflict (key) do nothing;`);
    expect(up).toContain(`s.key = '${ALARM_SWITCH_KEY}'), '') = 'false'`);          // only exactly 'false' silences
    expect((up.match(/app_settings/g) || []).length).toBe(2);                       // the insert + the one read
  });
  it("the connections alarm: 70 % up on 2 checks, under 60 % on 3 checks, every 5 minutes, sent through sql/195's function only", () => {
    for (const line of ["c_warn_pct   constant integer  := 70;", "c_clear_pct  constant integer  := 60;", "c_up         constant integer  := 2;", "c_down       constant integer  := 3;", "c_tries      constant integer  := 3;"]) expect(up).toContain(line);
    expect(up).toContain("select cron.schedule('db-capacity-alarm', '1-59/5 * * * *', 'select public.db_capacity_check()');");
    expect(up).toContain("from pg_stat_activity a where a.backend_type = 'client backend'");
    expect(up).toContain("current_setting('max_connections', true)");
    expect((up.match(/parcel_silence_send\(/g) || []).length).toBe(2);              // the guard + the one send
    expect(up).not.toMatch(/extensions\.http|vault\.|api\.telegram\.org|net\.http/); // no second way out, no secret handled here
    expect(up).toContain("revoke all on function public.db_capacity_check(integer, integer, timestamptz) from public, anon, authenticated, service_role;");
    expect(up).not.toMatch(/security definer/i);
  });
  it("the texts are fixed words + numbers: nothing from a table goes into a message", () => {
    const texts = up.slice(up.indexOf("v_text := case st.pending"), up.indexOf("begin\n        v_word := public.parcel_silence_send"));
    expect(texts.match(/\|\| ([a-z_.]+) \|\|/g)).toEqual(["|| v_used ||", "|| v_max ||", "|| v_pct ||", "|| v_used ||", "|| v_max ||", "|| v_pct ||"]);
    expect(up).toMatch(/v_used\s+integer;/); expect(up).toMatch(/v_max\s+integer;/); expect(up).toMatch(/v_pct\s+integer;/);
  });
  it("one transaction, a guard that refuses a half-ready database, and a rollback that leaves sql/195 alone", () => {
    expect(up.trim().startsWith("begin;") && up.trim().endsWith("commit;")).toBe(true);
    expect(up).toContain("raise exception 'sql/215: sql/195 (parcel_silence_send) is not applied — nothing was changed';");
    expect(down.trim().startsWith("begin;") && down.trim().endsWith("commit;")).toBe(true);
    for (const gone of ["cron.unschedule('db-capacity-alarm')", "drop function if exists public.db_capacity_check(integer, integer, timestamptz);", "drop table if exists public.db_capacity_state;", `drop table if exists public.${RUNS_TABLE};`, `delete from public.app_settings where key = '${ALARM_SWITCH_KEY}';`]) expect(down).toContain(gone);
    expect(down).not.toMatch(/parcel_silence|drop extension|vault/);
  });
});
