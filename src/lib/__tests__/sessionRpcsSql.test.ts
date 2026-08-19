// sql/21 session RPC contracts — the sql/ file is the canonical text applied to
// prod via MCP; these pin the load-bearing invariants of the explicit-session
// lifecycle so a future edit can't silently break them:
//   1. SECURITY INVOKER (own-row via auth.uid() + RLS; never a DEFINER bypass),
//   2. the ended-check is Asia/Taipei + server now() (NOT a device clock),
//   3. start_session validates length 1..4 and stamps server now() + a fresh uuid,
//   4. start_session must NOT write window_start / window_days (old fields frozen),
//   5. execute granted to authenticated only (revoked from public/anon).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(__dirname, "../../../sql", "21_session_rpcs.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();

describe("sql/21 session RPCs", () => {
  it("both functions are SECURITY INVOKER, never DEFINER", () => {
    expect((code.match(/security invoker/g) ?? []).length).toBe(2);
    expect(code).not.toContain("security definer");
  });

  it("ended-check uses server now() at Asia/Taipei (not the device clock)", () => {
    expect(code).toContain("now() at time zone 'asia/taipei'");
    // start compared against the stored start, also converted to Taipei
    expect(code).toContain("session_started_at at time zone 'asia/taipei'");
    // the window bound is start + (window_days - 1)
    expect(code).toContain("session_window_days - 1");
  });

  it("start_session validates length 1..4 and stamps server now() + a fresh uuid", () => {
    expect(code).toContain("gen_random_uuid()");
    expect(code).toMatch(/session_started_at\s*[=,]?\s*now\(\)|values[\s\S]*now\(\)/);
    expect(code).toContain("p_days < 1 or p_days > 4");
    expect(code).toContain("raise exception");
  });

  it("start_session does NOT write window_start / window_days (old model frozen)", () => {
    // isolate the start_session body
    const start = code.slice(code.indexOf("function public.start_session"));
    expect(start).not.toContain("window_start");        // no session_window_start column exists → any hit = old field
    // window_days ONLY as part of the NEW session_window_days token (lookbehind
    // excludes "session_"): a standalone old-model window_days must NOT appear.
    expect(start).not.toMatch(/(?<!session_)window_days/);
    expect(start).toContain("session_window_days");     // it DOES write the new dedicated length column
  });

  it("execute: authenticated only (revoked from public/anon)", () => {
    expect(code).toContain("revoke execute on function public.session_status()        from public, anon");
    expect(code).toContain("revoke execute on function public.start_session(smallint) from public, anon");
    expect(code).toContain("grant  execute on function public.session_status()        to authenticated");
    expect(code).toContain("grant  execute on function public.start_session(smallint) to authenticated");
  });
});
