// COMMENT PERSISTENCE SQL contracts — sql/17 is the canonical text chat-Claude
// applies to prod via MCP; these tests pin the load-bearing invariants:
//   1. the restore RPC is the STRUCTURAL 500-cap (audit F1): SECURITY INVOKER,
//      explicit auth.uid() filter, server-side LIMIT — no client refactor can
//      un-cap read egress;
//   2. the purge cron implements Jeff's window-close retention and can NEVER
//      delete a LIVE window: day keys strictly BEFORE today, multi-day keys
//      only once start + N ≤ today, and the multi-day digit range tracks the
//      CLIENT's max window (audit F7 — both sources, so a future 7-day window
//      can't silently get purged mid-session);
//   3. rows are immutable to clients: select + insert own ONLY (no update, no
//      delete policy — the cron purges as postgres).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clampWindowDays } from "../useSessionWindow";
import { RESTORE_CAP } from "../commentHistory";

const sql = readFileSync(resolve(__dirname, "../../../../sql", "17_session_comments.sql"), "utf8");

describe("restore RPC — the structural cap (audit F1)", () => {
  it("SECURITY INVOKER + explicit auth.uid() filter (miners_stats pattern)", () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("b.user_id = (select auth.uid())");
  });
  it(`caps the flattened result at ${RESTORE_CAP} SERVER-SIDE`, () => {
    expect(sql).toContain(`limit ${RESTORE_CAP}`);
  });
  it("orders tuples by the embedded timestamp at index 4 (codec lockstep)", () => {
    expect(sql).toContain("e.tuple->>4");
  });
  it("execute: authenticated only (revoked from public + anon)", () => {
    expect(sql).toMatch(/revoke execute on function public\.session_comments_restore\(text\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.session_comments_restore\(text\) to authenticated/);
  });
});

describe("purge cron — window-close retention (Jeff decision)", () => {
  const purge = /DELETE FROM public\.session_comment_batches\s+WHERE ([\s\S]+?)\$\$/m.exec(sql)?.[1] ?? "";

  it("day keys: deleted only when strictly BEFORE today(Taipei) — today's live window survives", () => {
    expect(purge).toMatch(/session_key::date < \(now\(\) AT TIME ZONE 'Asia\/Taipei'\)::date/);
  });
  it("multi-day keys: deleted only when start + N ≤ today — mirrors computeWindowState expiry", () => {
    expect(purge).toMatch(/split_part\(session_key, '~', 1\)::date/);
    expect(purge).toMatch(/<= \(now\(\) AT TIME ZONE 'Asia\/Taipei'\)::date/);
  });
  it("multi-day digit range covers EXACTLY the client's max window (audit F7 — both sources)", () => {
    const digit = /~\[1-(\d)\]d/.exec(purge)?.[1];
    const clientMax = Math.max(...[1, 2, 3, 4, 5, 6, 7].map(clampWindowDays));
    expect(digit).toBe(String(clientMax)); // today: 3 — bump BOTH or neither
  });
  it("malformed-key safety net ages out ABOVE the max window length (can't touch a live window)", () => {
    const days = Number(/interval '(\d+) days'/.exec(purge)?.[1]);
    const clientMax = Math.max(...[1, 2, 3, 4, 5, 6, 7].map(clampWindowDays));
    expect(days).toBeGreaterThan(clientMax);
  });
  it("runs at the jobid-1 slot family (01:00 Taipei, 1h after the midnight window boundary)", () => {
    expect(sql).toContain("'0 17 * * *'");
    expect(sql).toContain("purge-closed-session-comments");
  });
});

describe("RLS — immutable-to-clients rows", () => {
  it("select + insert own ONLY; RLS enabled; no update/delete policy exists", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/create policy scb_select .* for select using \(user_id = \(select auth\.uid\(\)\)\)/s);
    expect(sql).toMatch(/create policy scb_insert .* for insert with check \(user_id = \(select auth\.uid\(\)\)\)/s);
    expect(sql).not.toMatch(/for update/);
    expect(sql).not.toMatch(/for delete/);
  });
});
