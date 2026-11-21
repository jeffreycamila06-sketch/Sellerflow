// sql/195 (+ rollback) — the Telegram alert from the DATABASE when nobody is checking parcels (2026-11-21).
// Text pins. The behaviour itself — the rule, the night window, the 60-min repeat, "back", retries, the test function,
// the grants with Supabase's default grants in place, and that the token / chat id never leave the one send request —
// is proven on a real Postgres by scripts/sql195-behaviour.mjs (PGlite); these pins catch an edit of the files that
// the script would only see when someone runs it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const FILE = read("sql/195_parcel_silence_alert.sql");
const BACK = read("sql/195_parcel_silence_alert_rollback.sql");
const CHECK = read("docs/ops/db-silence-alert-check.sql");
const SERVER = read("server/telegramAlert.js");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const C = code(FILE);
const fn = (name: string) => {
  const at = C.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return "";
  return C.slice(at, C.indexOf("$function$;", C.indexOf("$function$", at) + 10) + "$function$;".length);
};
const SEND = fn("parcel_silence_send"), CHK = fn("parcel_silence_check"), TEST = fn("admin_parcel_silence_test");

describe("sql/195 — the files", () => {
  it("are number 195 (+ rollback); no other file uses the number; NOT applied", () => {
    expect(readdirSync("sql").filter((f) => /^195_/.test(f)).sort()).toEqual(["195_parcel_silence_alert.sql", "195_parcel_silence_alert_rollback.sql"]);
    expect(FILE).toMatch(/NOT APPLIED/);
  });
  it("one transaction with a lock limit; a guard that refuses a second run or a missing http / pg_cron", () => {
    for (const s of [C, code(BACK)]) {
      expect(s).toMatch(/^begin;\nset local lock_timeout = '2s';/m);
      expect(s.trim().endsWith("commit;")).toBe(true);
    }
    expect(C).toContain("the http extension is not in schema extensions — nothing was changed");
    expect(C).toContain("pg_cron is missing — nothing was changed");
    expect(C).toContain("parcel_silence tables already exist — nothing was changed");
  });
  it("sends with the http extension, never pg_net (pg_net keeps the address in a table open to PUBLIC)", () => {
    expect(C.split("create extension if not exists http with schema extensions;").length).toBe(2);
    expect(C).not.toMatch(/pg_net|\bnet\./);
    expect(SEND).toContain("from extensions.http((");
    expect(C.match(/extensions\.http\(/g)?.length).toBe(1 + 2);   // the one call + the two to_regprocedure checks
  });
  it("creates exactly two tables and three functions, and one cron job every 10 minutes at :03", () => {
    expect([...C.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1])).toEqual(["parcel_silence_state", "parcel_silence_log"]);
    expect([...C.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1])).toEqual(["parcel_silence_send", "parcel_silence_check", "admin_parcel_silence_test"]);
    expect(C).toContain("select cron.schedule('parcel-silence-alert', '3-59/10 * * * *', 'select public.parcel_silence_check()');");
    expect(C).not.toMatch(/\b(insert into|update) public\.app_settings\b/);
  });
});

describe("sql/195 — the secrets never leave the send", () => {
  it("are read from Vault by name, with the server's own shapes", () => {
    expect(SEND).toContain("s.name = 'telegram_bot_token'");
    expect(SEND).toContain("s.name = 'telegram_chat_id'");
    const tokenRe = /const TOKEN_RE = \/(.+)\/;/.exec(SERVER)![1].replaceAll("\\d", "[0-9]");
    const chatRe = /const CHAT_RE = \/(.+)\/;/.exec(SERVER)![1].replaceAll("\\d", "[0-9]");
    expect(SEND).toContain(`v_token !~ '${tokenRe}'`);
    expect(SEND).toContain(`v_chat !~ '${chatRe}'`);
  });
  it("the token is used in ONE expression: the request address", () => {
    const uses = SEND.split("\n").filter((l) => /\bv_token\b/.test(l)).map((l) => l.trim());
    expect(uses).toEqual([
      "v_token   text;",
      "select s.decrypted_secret into v_token from vault.decrypted_secrets s",
      "v_token := btrim(coalesce(v_token, ''));",
      "if v_token = '' or v_chat = '' then return 'no_secrets'; end if;",
      "if v_token !~ '^[0-9]{3,20}:[A-Za-z0-9_-]{10,100}$' or v_chat !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{3,64})$' then",
      "'https://api.telegram.org/bot' || v_token || '/sendMessage',",
    ]);
    expect(CHK + TEST).not.toMatch(/v_token|v_chat|decrypted_secret|vault\./);
  });
  it("no notice, warning or log message anywhere; an error text is only looked at, never kept", () => {
    expect(C).not.toMatch(/raise\s+(notice|warning|info|log|debug)/i);
    expect([...C.matchAll(/raise exception/g)].length).toBe(3);            // the three guard lines, before anything exists
    expect(C.match(/sqlerrm/gi)).toEqual(["sqlerrm"]);
    expect(SEND).toContain("return case when sqlerrm ~* 'time[ds]? ?out|timeout' then 'timeout' else 'net_error' end;");
    expect(C).not.toMatch(/sqlstate|pg_exception|get stacked diagnostics/i);
  });
  it("every log write carries counts and one word; the text kept for a retry is built from counts only", () => {
    for (const l of C.split("\n").filter((x) => /insert into parcel_silence_log/.test(x))) expect(l).not.toMatch(/v_token|v_chat|sqlerrm|p_text|v_text/);
    expect(C).toMatch(/result\s+text not null check \(result ~ '\^\[a-z0-9_\]\{1,24\}\$'\)/);
    expect(CHK).toContain("v_text := format('⚠️ Walang nagche-check ng parcel nang %s min — %s parcels naghihintay (%s sellers). Tingnan ang Lenovo at ang server.',");
    expect(CHK).toContain("coalesce(v_min::text, '30+'), v_waiting, v_sellers);");
    expect(CHK).toContain("v_text := '✅ May nagche-check na ulit.';");
    expect(CHK.match(/v_text :=/g)?.length).toBe(2);
  });
});

describe("sql/195 — the rule", () => {
  it("waiting = the checker's own queue rows, 30 min to 2 days old", () => {
    expect(CHK).toContain("join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled");
    expect(CHK).toContain("where ps.status <> 'exported'");
    expect(CHK).toContain("and (ps.store_full_status is null or ps.phone_check_status is null)");
    expect(CHK).toContain("c_young   constant interval := interval '30 minutes';");
    expect(CHK).toContain("c_old     constant interval := interval '2 days';");
    expect(CHK).toContain("(v_pool_n > 0 or exists (select 1 from seller_myship_config cfg");
  });
  it("an answer = store log, phone answer, frozen answer of a checker (never the copy on save)", () => {
    expect(CHK).toContain("from store_check_log l where l.checked_at <= v_now order by l.id desc limit 1");
    expect(CHK).toContain("max(p.phone_check_at) from parcel_scans p where p.phone_check_status is not null");
    expect(CHK).toContain("where f.source in ('live','cache','warmup')");
    expect(CHK).not.toMatch(/'instant'/);
  });
  it("30 min quiet, 60 min repeat, 3 tries, 20 s, night 01:00–05:00 Taipei", () => {
    expect(CHK).toContain("c_quiet   constant interval := interval '30 minutes';");
    expect(CHK).toContain("c_repeat  constant interval := interval '60 minutes';");
    expect(CHK).toContain("c_tries   constant integer  := 3;");
    expect(CHK).toContain("c_send_ms constant integer  := 20000;");
    expect(CHK).toContain("c_again   constant text     := ' (sent again)';");
    expect(CHK).toContain("if extract(hour from v_now at time zone 'Asia/Taipei')::int between 1 and 4 then");
    expect(CHK.match(/'timeout','net_error','not_ok','http_429'\) or v_word ~ '\^http_5\[0-9\]\[0-9\]\$'/g)?.length).toBe(2);
  });
});

describe("sql/195 — who may do what", () => {
  it("check + send run as the caller and are closed to everyone but their owner; only the test runs as its owner", () => {
    expect(SEND).not.toMatch(/security definer/i);
    expect(CHK).not.toMatch(/security definer/i);
    expect(TEST).toMatch(/security definer/);
    for (const f of [SEND, CHK, TEST]) expect(f).toContain("set search_path = public, pg_temp");
    expect(C).toContain("revoke all on function public.parcel_silence_send(text, integer)      from public, anon, authenticated, service_role;");
    expect(C).toContain("revoke all on function public.parcel_silence_check(timestamptz)       from public, anon, authenticated, service_role;");
    expect(C).toContain("revoke all on function public.admin_parcel_silence_test()             from public, anon, service_role;");
    expect(C.match(/grant [a-z ,]+ on function/g)).toEqual(["grant execute on function"]);
    expect(C).toContain("grant execute on function public.admin_parcel_silence_test() to authenticated;");
  });
  it("the tables: RLS on, no browser access, the log readable by admins only", () => {
    expect(C).toContain("alter table public.parcel_silence_state enable row level security;");
    expect(C).toContain("alter table public.parcel_silence_log   enable row level security;");
    expect(C).toContain("revoke all on public.parcel_silence_state from public, anon, authenticated, service_role;");
    expect(C).toContain("revoke all on public.parcel_silence_log   from public, anon, authenticated, service_role;");
    expect(C.match(/grant select on/g)?.length).toBe(1);
    expect(C).toContain("for select to authenticated using (public.is_admin());");
  });
  it("the test: SQL editor (session user postgres) or an app admin; 6 s from the app, 20 s from the editor; one a minute", () => {
    expect(TEST).toContain("v_pg   boolean := (session_user = 'postgres');");
    expect(TEST).toContain("if not coalesce(public.is_admin(), false) then return 'forbidden'; end if;");
    expect(TEST).toContain("case when v_pg then 20000 else 6000 end");
    expect(TEST).toContain("kind = 'test' and at > now() - interval '1 minute'");
  });
});

describe("sql/195 — the rollback and the post-apply check", () => {
  it("the rollback removes the job, the functions, the tables and the http extension — not the Vault secrets", () => {
    const B = code(BACK);
    expect(B).toContain("perform cron.unschedule('parcel-silence-alert');");
    for (const x of ["drop function if exists public.admin_parcel_silence_test();", "drop function if exists public.parcel_silence_check(timestamptz);",
      "drop function if exists public.parcel_silence_send(text, integer);", "drop table if exists public.parcel_silence_log;",
      "drop table if exists public.parcel_silence_state;", "drop extension if exists http;"]) expect(B).toContain(x);
    expect(B).not.toMatch(/vault/i);
  });
  it("the post-apply check is read only and never reads a secret value", () => {
    const K = code(CHECK);
    expect(K).toMatch(/^begin;\nset local statement_timeout = '5s';/m);
    expect(K.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i);   // outside quoted names
    const bare = K.replace(/'[^']*'/g, "''");
    expect(bare).not.toMatch(/decrypted_secret|\bsecret\b(?!s)/);                                 // no secret column is read …
    expect(bare.match(/vault\.[a-z_]+/g)).toEqual(["vault.secrets"]);                             // … only names from vault.secrets
    expect(K).toContain("string_agg(name::text, ',' order by name), 'none') from vault.secrets where name in");
    for (const t of ["net.http_request_queue", "net._http_response"]) expect(K).toContain(`to_regclass('${t}')`);
  });
});
