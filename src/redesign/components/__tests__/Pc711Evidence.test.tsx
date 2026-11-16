// Admin → 7-11 Login → Evidence block (sql/172): totals (after vs mirror; fresh vs remembered for phone
// and store; the "restricted" line; store answer age), filters (mismatch / re-check / mirror / error),
// a row opens to its full details. fetch is mocked.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Pc711EvidenceBlock from "../Pc711Evidence";
import { TProvider } from "../../i18n";
import { toPc711EvRow, pairsBySource } from "../../adapters/pc711Evidence";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const urls: string[] = [];
let answers: (path: string, q: URLSearchParams) => Record<string, unknown> = () => ({});
beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = new URL(url, "http://x");
    urls.push(`${u.pathname}${u.search}`);
    return { ok: true, status: 200, json: async () => answers(u.pathname.replace("/admin/pc711", ""), u.searchParams) };
  });
});
afterEach(() => { urls.length = 0; vi.restoreAllMocks(); });

const TOTALS = {
  rows: 30, rechecks: 3, flags: 1, reasked: 1, errors: { after: 2, mirror: 1 },
  pairs: [
    { mode: "after", kind: "phone", source: "fresh", compared: 10, agree: 10 },
    { mode: "after", kind: "phone", source: "remembered", compared: 2, agree: 0 },
    { mode: "after", kind: "store", source: "fresh", compared: 8, agree: 8 },
    { mode: "after", kind: "store", source: "remembered", compared: 7, agree: 0 },
    { mode: "mirror", kind: "phone", source: "fresh", compared: 3, agree: 3 },
  ],
  mirror: { n: 4, serverFirst: 3, extensionFirst: 1, avgFirstByMs: 1800, late: 1, timeout: 0 },
  storeAge: { n: 15, avgS: 640, maxS: 3428 }, restricted: { agree: 6, disagree: 2 },
};
const MIS = { id: 7, at: "2026-11-16T15:51:47Z", kind: "phone", round: 1, mode: "after", match: false, ext_verdict: "restricted", srv_verdict: "ok", ext_source: "remembered", reask_n: 2, reask1_word: "ok", reask2_word: "ok", srv_ms: 800 };
const ERR = { id: 8, at: "2026-11-16T15:52:00Z", kind: "store", round: 1, mode: "after", match: null, fail_step: "store.byid", fail_http: 429, fail_reason: "http", fail_at: "2026-11-16T15:52:01Z", srv_ms: 300 };
const RECHECK = { id: 9, at: "2026-11-16T15:53:00Z", kind: "phone", round: 2, mode: "after", match: true, ext_verdict: "ok", srv_verdict: "ok", ext_source: "fresh", flag: "phone_changed_verdict_kept", srv_ms: 700 };
const MIRROR = { id: 10, at: "2026-11-16T15:54:00Z", kind: "phone", round: 1, mode: "mirror", match: true, ext_verdict: "ok", srv_verdict: "ok", ext_source: "fresh", ext_late: true, first: "server", first_by_ms: 1500, srv_ms: 700, pair_closed: true, ext_at: "2026-11-16T16:10:00Z" };
const DETAIL = { ...MIS, scan_id: "00000000-0000-0000-0000-000000000597", seller_id: "seller-uuid", store_id: "151003", phone: "0912345678", parcel_created_at: "2026-11-16T15:51:37Z",
  ext_at: "2026-11-16T15:51:42Z", ext_message: "此手機號碼暫停服務至2026/11/30", ext_restricted_until: "2026-11-30", ext_cache_at: "2026-11-16T10:00:00Z",
  srv_started_at: "2026-11-16T15:51:46Z", srv_finished_at: "2026-11-16T15:51:47Z", srv_raw: "Status:true", queue_waiting: 3,
  reask1_at: "2026-11-16T15:52:17Z", reask2_at: "2026-11-16T15:56:47Z" };

function setup(rows: Record<string, unknown>[] = [MIS, ERR, RECHECK, MIRROR], selfStop: Record<string, unknown> = {}) {
  answers = (path, q) => path === "/evidence/totals" ? { day: q.get("day"), mirrorEnabled: false, totals: TOTALS, selfStop }
    : path === "/evidence" ? { page: 0, more: false, rows: q.get("filter") === "all" ? rows : rows.slice(0, 1) }
    : path === "/evidence/7" ? { row: DETAIL } : {};
  return render(<TProvider lang="en"><Pc711EvidenceBlock /></TProvider>);
}

describe("totals", () => {
  it("after-mode and mirror apart; fresh vs remembered apart for phone and store; restricted line; store age; mirror line", async () => {
    setup();
    await screen.findByTestId("pc711-ev-totals");
    expect(screen.getByTestId("pc711-ev-mirror-state").textContent).toContain("Mirror is off");
    expect(screen.getByTestId("pc711-ev-after-phone").textContent).toBe("Phone: fresh 10/10 · remembered 0/2 · not known — (agree/compared)");
    expect(screen.getByTestId("pc711-ev-after-store").textContent).toBe("Store full: fresh 8/8 · remembered 0/7 · not known — (agree/compared)");
    expect(screen.getByTestId("pc711-ev-mirror-phone").textContent).toContain("fresh 3/3");
    expect(screen.getByTestId("pc711-ev-restricted").textContent).toBe("Restricted phones: 6 agree · 2 disagree");
    expect(screen.getByTestId("pc711-ev-storeage").textContent).toContain("average 640 s · max 3428 s (15)");
    expect(screen.getByTestId("pc711-ev-mirror-line").textContent).toContain("Server first 3 · extension first 1 · average gap 1800 ms · late 1");
    expect(screen.getByTestId("pc711-ev-errors").textContent).toBe("Errors: after 2 · mirror 1");
  });
  it("pairsBySource adds up a mode + kind by source", () => {
    expect(pairsBySource(TOTALS.pairs as never, "after", "store").remembered).toEqual({ agree: 0, compared: 7 });
  });
});

describe("mirror self-stop on Admin", () => {
  it("not stopped: says so; no 'silent' line", async () => {
    setup();
    expect((await screen.findByTestId("pc711-ev-selfstop")).textContent).toBe("Mirror self-stop: has not stopped");
    expect(screen.queryByTestId("pc711-ev-silent")).toBeNull();
  });
  it("stopped: when and which rule fired (with the number)", async () => {
    setup(undefined, { lastStop: { at: "2026-11-17T03:20:00Z", rule: "phone_time", value: 9.2, parcels: 40 } });
    expect((await screen.findByTestId("pc711-ev-selfstop")).textContent).toBe("Mirror stopped itself at 11/17 11:20:00: typical phone time over 7 s (9.2)");
  });
  it("the extension silent: 'extension silent since <time>'", async () => {
    setup(undefined, { silentSince: "2026-11-17T03:05:00Z" });
    expect((await screen.findByTestId("pc711-ev-silent")).textContent).toBe("Extension silent since 11/17 11:05:00 (the \"waited\" rule is skipped)");
  });
});

describe("the list", () => {
  it("a mismatch shows fresh/remembered and the two re-ask answers; an error shows its step + date and time; a re-check and a mirror row say so", async () => {
    setup();
    const rows = await screen.findAllByTestId("pc711-ev-row");
    expect(rows[0].textContent).toContain("mismatch ext=restricted srv=ok · remembered · Asked again: ok / ok");
    expect(rows[1].textContent).toMatch(/store\.byid.*http=429 http 11\/16 23:52:01/);
    expect(rows[2].textContent).toContain("Re-check #2");
    expect(rows[2].textContent).toContain("phone_changed_verdict_kept");
    expect(rows[3].textContent).toContain("Mirror");
    expect(rows[3].textContent).toContain("late (after 15 min)");
    expect(rows.map((r) => r.textContent).join(" ")).not.toMatch(/09\d{8}/); // no phone in the list
  });
  it("filters: mismatch / re-check / mirror / error ask the server for that filter", async () => {
    setup();
    await screen.findAllByTestId("pc711-ev-row");
    for (const f of ["mismatch", "recheck", "mirror", "error"]) {
      fireEvent.click(screen.getByTestId(`pc711-ev-filter-${f}`));
      await waitFor(() => expect(urls.some((u) => u.includes(`/admin/pc711/evidence?day=today&filter=${f}&page=0`))).toBe(true));
    }
  });
  it("a row opens to its FULL details (one read by id): phone, store, seller, times, both answers, source + cache time, message, date, re-asks", async () => {
    setup();
    const rows = await screen.findAllByTestId("pc711-ev-row");
    fireEvent.click(rows[0]);
    const d = await screen.findByTestId("pc711-ev-detail");
    expect(urls.filter((u) => u.startsWith("/admin/pc711/evidence/7"))).toHaveLength(1);
    const v = (k: string) => within(d).getByTestId(`pc711-ev-d-${k}`).textContent;
    expect(v("phone")).toBe("0912345678");
    expect(v("store")).toBe("151003");
    expect(v("seller")).toBe("seller-uuid");
    expect(v("source")).toBe("remembered");
    expect(v("cache")).toBe("11/16 18:00:00");
    expect(v("message")).toBe("此手機號碼暫停服務至2026/11/30");
    expect(v("until")).toBe("2026-11-30");
    expect(v("created")).toBe("11/16 23:51:37");
    expect(v("ext_at")).toBe("11/16 23:51:42");
    expect(v("started")).toBe("11/16 23:51:46");
    expect(v("finished")).toBe("11/16 23:51:47");
    expect(v("srv")).toBe("ok · Status:true · 800 ms");
    expect(v("waiting")).toBe("3");
    expect(v("reask1")).toBe("ok · 11/16 23:52:17");
    expect(v("reask2")).toBe("ok · 11/16 23:56:47");
  });
  it("toPc711EvRow keeps no phone, store or message in the list row", () => {
    const r = toPc711EvRow({ ...DETAIL });
    expect(JSON.stringify(r)).not.toContain("0912345678");
    expect(JSON.stringify(r)).not.toContain("151003");
    expect(JSON.stringify(r)).not.toContain("此手機");
  });
});
