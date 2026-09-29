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
