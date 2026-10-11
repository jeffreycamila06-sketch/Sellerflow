// sql/63 contract — the on-demand job queue. Behaviour was validated against the real
// database in a rolled-back transaction (press → used_today → too_soon → second-device
// already_queued → claim → trigger → stale cleanup → other seller not_allowed → kill
// switch disabled → grants); these pins stop the load-bearing lines drifting.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/63_parcel_tracking_on_demand.sql", "utf8");
const fn = (name: string) => {
  const i = sql.indexOf(`function public.${name}(`);
  return sql.slice(i, sql.indexOf("$$;", i));
};

describe("sql/63 parcel_tracking on-demand jobs", () => {
  it("THE LOCK: one queued-or-running job per seller (partial unique index)", () => {
    expect(sql).toMatch(/create unique index if not exists parcel_tracking_jobs_one_active\s+on public\.parcel_tracking_jobs \(user_id\) where status in \('queued','running'\);/);
  });

  it("sellers read only their own jobs and can never write them", () => {
    expect(sql).toContain("revoke all on public.parcel_tracking_jobs from anon, authenticated;");
    expect(sql).toContain("grant select on public.parcel_tracking_jobs to authenticated;");
    expect(sql).toMatch(/for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
  });

  it("request_check: kill switch → allowlist/plan → kind, then a row lock before the daily rules", () => {
    const f = fn("parcel_tracking_request_check");
    const at = (s: string) => f.indexOf(s);
    expect(at("parcel_tracking_enabled")).toBeLessThan(at("parcel_tracking_can_use(v_uid)"));
    expect(at("parcel_tracking_can_use(v_uid)")).toBeLessThan(at("bad_kind"));
    expect(f).toContain("p_kind is null or p_kind not in ('manual', 'urgent')");
    expect(at("for update")).toBeLessThan(at("'used_today'"));
    expect(f).toContain("exception when unique_violation then");
    // the press is recorded only after the job row exists
    expect(at("insert into public.parcel_tracking_jobs (user_id, kind, created_by) values (v_uid, 'manual'")).toBeLessThan(at("set last_manual_check_at = now()"));
  });

  it("once per Taipei day and never within 12h", () => {
    const f = fn("parcel_tracking_next_manual_at");
    expect(f).toContain("p_last_day = public.parcel_tracking_taipei_today()");
    expect(f).toContain("now() - p_last_at < interval '12 hours'");
    expect(sql).toContain("(now() at time zone 'Asia/Taipei')::date");
  });

  it("can_use = admin, or Plus/Pro/Master with an enabled allowlist row", () => {
    const f = fn("parcel_tracking_can_use");
    expect(f).toContain("public.is_admin()");
    expect(f).toContain("in ('plus','pro','master')");
    expect(f).toContain("a.user_id = p_uid and a.enabled");
  });

  it("worker claim: fails 45-min-stale running jobs, then SKIP LOCKED oldest queued", () => {
    const f = fn("parcel_tracking_claim_job");
    expect(f).toMatch(/set status = 'failed', error = 'restart'[\s\S]*started_at < now\(\) - interval '45 minutes'/);
    expect(f).toMatch(/order by q\.requested_at\s+limit 1\s+for update skip locked/);
  });

  it("claim + enqueue are service-role only", () => {
    expect(sql).toContain("revoke all on function public.parcel_tracking_claim_job() from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.parcel_tracking_claim_job() to service_role;");
    expect(sql).toContain("revoke all on function public.parcel_tracking_enqueue_job(uuid, text, text, timestamptz) from public, anon, authenticated;");
    expect(fn("parcel_tracking_enqueue_job")).toContain("on conflict (user_id) where status in ('queued','running') do nothing");
  });

  it("new-parcel trigger: seller inserts only, statement-level, never blocks the upload", () => {
    const f = fn("parcel_tracking_enqueue_new");
    expect(f).toContain("if auth.uid() is null then return null; end if;");
    expect(f).toContain("on conflict (user_id) where status in ('queued','running') do nothing");
    expect(f).toMatch(/exception when others then\s+return null;/);
    expect(sql).toMatch(/after insert on public\.parcel_tracking\s+referencing new table as new_rows\s+for each statement/);
  });
});

describe("sql/64 refund the daily press", () => {
  const sql64 = readFileSync("sql/64_parcel_tracking_refund_press.sql", "utf8");
  const fn64 = (name: string) => {
    const i = sql64.indexOf(`function public.${name}(`);
    return sql64.slice(i, sql64.indexOf("$$;", i));
  };
  it("the refund function exists and is service-role only", () => {
    expect(sql64).toContain("create or replace function public.parcel_tracking_refund_press(p_job_id uuid)");
    expect(sql64).toContain("revoke all on function public.parcel_tracking_refund_press(uuid) from public, anon, authenticated;");
    expect(sql64).toContain("grant execute on function public.parcel_tracking_refund_press(uuid) to service_role;");
  });
  it("refunds only kind='manual' AND created_by='seller' jobs, and clears both press columns", () => {
    const f = fn64("parcel_tracking_refund_press");
    expect(f).toContain("j.kind = 'manual' and j.created_by = 'seller'");
    expect(f).toContain("if v_user is null then return false; end if;");
    expect(f).toContain("set last_manual_check_at = null, last_manual_check_day = null");
  });
  it("claim refunds every stale job it fails, and keeps SKIP LOCKED + service-role grant", () => {
    const f = fn64("parcel_tracking_claim_job");
    expect(f).toMatch(/set status = 'failed', error = 'restart'[\s\S]*returning id\s+loop\s+perform public\.parcel_tracking_refund_press\(v_id\);/);
    expect(f).toContain("for update skip locked");
    expect(sql64).toContain("grant execute on function public.parcel_tracking_claim_job() to service_role;");
  });
});

// sql/122 — Check now = 12 hours after the LAST press (no once-per-Taipei-day rule). The press
// timings (20:00 → 08:00 next day, 00:17 → 12:17, 11h59m locked, 12h allowed) are proved on a real
// Postgres by scripts/sql122-behaviour.mjs; these pins stop the changed lines drifting.
describe("sql/122 Check now: 12h after the last press", () => {
  const up = readFileSync("sql/122_check_now_12h.sql", "utf8");
  const down = readFileSync("sql/122_check_now_12h_rollback.sql", "utf8");
  const sql119 = readFileSync("sql/119_fm_pickup.sql", "utf8");
  const between = (src: string, start: string, end: string) => {
    const i = src.indexOf(start);
    return src.slice(i, src.indexOf(end, i) + end.length);
  };
  const nm = (src: string) => between(src, "create or replace function public.parcel_tracking_next_manual_at(", "\n$$;");
  const rc = (src: string) => between(src, "create or replace function public.parcel_tracking_request_check(p_kind text default 'manual'::text)", "\n$function$;");
  const st = (src: string) => between(src, "create or replace function public.parcel_tracking_status()", "\n$$;");

  it("next_manual_at: null after 12h, else last press + 12h; no Taipei-day rule; same signature", () => {
    const f = nm(up);
    expect(f).toContain("public.parcel_tracking_next_manual_at(p_last_at timestamptz, p_last_day date)");
    expect(f).toContain("when p_last_at is null then null");
    expect(f).toContain("when now() - p_last_at >= interval '12 hours' then null");
    expect(f).toContain("else p_last_at + interval '12 hours'");
    expect(f).not.toContain("taipei_today");
    expect(f).not.toContain("p_last_day =");
  });

  it("request_check = the live sql/119 definition minus the used_today block, nothing else", () => {
    const live = rc(sql119);
    const block = "    if v_acc.last_manual_check_day = v_today then\n      return jsonb_build_object('ok', false, 'reason', 'used_today', 'next_available_at', v_next);\n    end if;\n";
    expect(live).toContain(block);
    expect(rc(up)).toBe(live.replace(block, ""));
    const f = rc(up);
    expect(f).not.toContain("'used_today'");
    expect(f).toContain("'reason', 'too_soon', 'next_available_at', v_next");
    expect(f).toContain("for update");
    expect(f).toContain("set last_manual_check_at = now(), last_manual_check_day = v_today");
    expect(f).toContain("t.carrier = '711'");
    expect(f).toContain("'urgent_used_today'");
  });

  it("status: used_today = locked by the 12h rule (next_manual_at in the future); rest unchanged", () => {
    const live = st(readFileSync("sql/63_parcel_tracking_on_demand.sql", "utf8"));
    const oldLine = "'used_today',           coalesce(v_acc.last_manual_check_day = v_today, false),";
    const newLine = "'used_today',           coalesce(public.parcel_tracking_next_manual_at(v_acc.last_manual_check_at, v_acc.last_manual_check_day) > now(), false),";
    expect(live).toContain(oldLine);
    expect(st(up)).toBe(live.replace(oldLine, newLine));
  });

  it("rollback restores the exact sql/63 + sql/119 definitions", () => {
    const sql63 = readFileSync("sql/63_parcel_tracking_on_demand.sql", "utf8");
    expect(nm(down)).toBe(nm(sql63));
    expect(rc(down)).toBe(rc(sql119));
    expect(st(down)).toBe(st(sql63));
    expect(down).not.toMatch(/drop[^;]*if exists/i);
  });
});
