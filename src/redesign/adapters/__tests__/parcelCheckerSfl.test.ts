// 1.14.5 — SFL token auto-refresh (the last hands-off gap). supabase-js pauses
// its refresh ticker while the SFL tab is hidden, so a backgrounded worker tab's
// token expired for hours overnight. The worker now: reads the token → asks the
// bridge to refresh IN PLACE (no reload) → falls back to a GET re-navigation →
// only red ("signed out") when the user is actually logged out. Never a loop,
// never a re-nav under an in-flight REST call. Driven through the REAL worker.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker, fakeJwt } from "./parcelCheckerHarness";

const sflReNavs = (calls: { update: unknown[] }) =>
  calls.update.filter((u) => /sellerflowlive\.com/.test(String((u as { props: { url?: string } }).props.url || "")));

describe("1.14.5 · SFL token auto-refresh", () => {
  it("expired token → in-place bridge refresh → connected WITHOUT a reload (log via=bridge)", async () => {
    const { sb, calls, status, booted } = bootWorker({
      sflToken: () => fakeJwt(-100),                                   // localStorage token is expired
      onSflRefresh: () => ({ token: fakeJwt(3600), hadSession: true }), // the app's client hands back a fresh one
    });
    await booted;
    await sb.pcPoll();
    expect(status().sfl).toBe("connected");
    expect(sflReNavs(calls)).toEqual([]);                              // no reload / re-nav
    expect(calls.sendMessage.some((m) => m.type === "SFL_REFRESH_TOKEN")).toBe(true);
    expect(calls.logs.some((l) => /^\[PC-SFL\] token refreshed via=bridge exp=/.test(l))).toBe(true);
  });

  it("in-place refresh unavailable → ONE GET re-navigation of the SFL tab → connected on the next poll (log via=reload); never a second re-nav", async () => {
    let tok = fakeJwt(-100);                                           // expired until the tab re-inits
    const { sb, calls, status, booted } = bootWorker({
      sflToken: () => tok,
      onSflRefresh: () => ({ token: null, hadSession: null }),         // helper/app hook absent
    });
    await booted;
    await sb.pcPoll();
    expect(status().sfl).toBe("refreshing");
    expect(sflReNavs(calls).length).toBe(1);                          // exactly one GET re-nav
    expect((sflReNavs(calls)[0] as { id: number }).id).toBe(1);
    expect(calls.logs.some((l) => /^\[PC-SFL\] re-navigating SFL tab 1 /.test(l))).toBe(true);
    // the re-navigated app boots supabase-js → _recoverAndRefresh → fresh token
    tok = fakeJwt(3600);
    await sb.pcPoll();
    expect(status().sfl).toBe("connected");
    expect(sflReNavs(calls).length).toBe(1);                          // still ONE — the episode is not re-navigated twice
    expect(calls.logs.some((l) => /^\[PC-SFL\] token refreshed via=reload exp=/.test(l))).toBe(true);
  });

  it("actually logged out (hadSession=false) → red 'signed_out', NO re-nav, NO loop", async () => {
    const { sb, calls, status, booted } = bootWorker({
      sflToken: () => fakeJwt(-100),
      onSflRefresh: () => ({ token: null, hadSession: false }),        // the app's client reports no session
    });
    await booted;
    await sb.pcPoll();
    expect(status().sfl).toBe("signed_out");
    expect(sflReNavs(calls)).toEqual([]);
    await sb.pcPoll();
    await sb.pcPoll();
    expect(status().sfl).toBe("signed_out");
    expect(sflReNavs(calls)).toEqual([]);                             // never re-navigates a logged-out tab
  });

  it("a fresh token straight away → connected, no refresh call, no re-nav", async () => {
    const { sb, calls, status, booted } = bootWorker({ sflToken: () => fakeJwt(3600) });
    await booted;
    await sb.pcPoll();
    expect(status().sfl).toBe("connected");
    expect(calls.sendMessage.some((m) => m.type === "SFL_REFRESH_TOKEN")).toBe(false);
    expect(sflReNavs(calls)).toEqual([]);
  });

  it("source: the worker NEVER runs its own refresher (no supabase client / token endpoint), and autoDiscardable covers the SFL tab", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    expect(bg).not.toMatch(/grant_type=refresh_token|createClient|refreshSession/); // never our own refresh
    expect(bg).toContain("pcNoDiscard(tab.id);");                    // pcHealTab pins autoDiscardable:false on every tab incl. SFL
    expect(bg).toContain('const PC_SFL_PATTERNS = ["https://www.sellerflowlive.com/*"');
    // the re-nav is a GET tabs.update({url}), not a tabs.reload (no extra reload site)
    const ladder = bg.slice(bg.indexOf("async function pcSflToken"), bg.indexOf("async function pcFetchUnchecked"));
    expect(ladder).toContain("chrome.tabs.update(info.id, { url: info.url })");
    expect(ladder).not.toContain("chrome.tabs.reload(");
    // NEVER re-navigate while a REST call is in flight, and one re-nav per episode
    expect(ladder).toContain("!pcEv.sfl.reloadedEpisode && !pcEv.sfl.fetchInFlight");
    expect(bg).toContain("pcEv.sfl.fetchInFlight = true");           // set around the parcel-scan read + pending RPC
    // the web app exposes an in-place refresh of its ONE client (not a second one)
    const sup = readFileSync("src/supabase.ts", "utf8");
    expect(sup).toContain("__sflEnsureFreshSession");
    expect(sup).toContain("supabase.auth.refreshSession()");
  });
});
