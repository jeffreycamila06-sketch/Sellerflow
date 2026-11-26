// Settings → INVOICING: the session picker PER PLATFORM (2026-11-27). Every session belongs to one platform
// (switching platform starts a new session). Pins:
//   • each tab lists only its own platform's sessions (TikTok-only and Facebook-only sessions land on the
//     right tab), from the SAME loader as the Orders tab (adapters/pastSessions.ts usePastSessions + one
//     small platform read per session);
//   • "This session" is on the tab of the platform the session belongs to (its orders, else the one live);
//     with no orders and not live it is on every tab, with "No <platform> buyers in this session yet." —
//     the "can't be sent from here" note stays only for a real old session without a session id;
//   • a tab whose platform is not the running session's shows that platform's newest session, or
//     "No <platform> sessions yet.";
//   • a pick on one tab does not change the other tab's;
//   • the Orders tab's list is exactly as before (all sessions, no platform read).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));

import { TProvider, buildT, tpl } from "../../i18n";
import Invoicing from "../Invoicing";
import Orders from "../Orders";
import { DB, type FakeOrderRow } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { currentSessionPlatform, sessionOnTab, type InvoicePlatform } from "../../adapters/invoicing";
import { loadSessionPlatforms, sessionsOfPlatform, summariesFromRpc, __resetSessionPlatforms } from "../../adapters/pastSessions";

const t = buildT("en");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
// session ids are uuids (the Facebook tab sends only for a session with a real id)
const CUR = "c0000000-0000-4000-8000-000000000001";
const TT1 = "a0000000-0000-4000-8000-000000000011", TT2 = "a0000000-0000-4000-8000-000000000012";
const FB1 = "b0000000-0000-4000-8000-000000000021", FB2 = "b0000000-0000-4000-8000-000000000022";
const row = (sid: string, at: string, n: number, handle: string, platform: string, product = "Item", price = 100, uid = "u1"): FakeOrderRow =>
  ({ user_id: uid, session_id: sid, session_date: at.slice(0, 10), created_at: at, buyer_number: n, handle, customer_name: handle.replace("@", ""), platform, product, price, qty: 1, comment_msg_id: null, auto_code: null });
const TT_CUR = [row(CUR, "2026-11-27T05:00:00.000Z", 1, "@ana", "TikTok"), row(CUR, "2026-11-27T05:01:00.000Z", 2, "@ben", "TikTok")];
const FB_CUR = [row(CUR, "2026-11-27T05:00:00.000Z", 1, "Fe Cruz", "Facebook"), row(CUR, "2026-11-27T05:01:00.000Z", 2, "Gil Ong", "Facebook")];
const PAST = [
  row(TT1, "2026-11-25T05:00:00.000Z", 1, "@tia", "TikTok", "TT one", 200),
  row(TT2, "2026-11-20T05:00:00.000Z", 1, "@tom", "TikTok", "TT old", 120),
  row(FB1, "2026-11-26T05:00:00.000Z", 1, "Fay Uy", "Facebook", "FB new", 300),
  row(FB1, "2026-11-26T05:10:00.000Z", 2, "Gus Go", "Facebook", "FB new 2", 50),
  row(FB2, "2026-11-22T05:00:00.000Z", 1, "Flo Sy", "Facebook", "FB old", 90),
  row("someone-else", "2026-11-24T05:00:00.000Z", 1, "@zed", "Facebook", "X", 1, "u2"),
];
const buyersOf = (rows: FakeOrderRow[]): Buyer[] => rebuildSessionFromRows(rows as unknown as LiveSessionRow[]).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 14; i++) await act(async () => { await Promise.resolve(); }); };
const tap = async (id: string) => { fireEvent.click(q(id)!); await flush(); };
const items = () => qa("ivc-session-item").map((b) => b.getAttribute("data-session"));
const openMenu = async () => { if (!q("ivc-session-menu")) await tap("ivc-session-btn"); };
const platformReads = () => DB.s.calls.filter((c) => c.table === "live_session_orders" && c.filters?.session_id !== undefined && c.filters?.platform === undefined && c.filters?.user_id === undefined);

// a server that lets Send all in (the Facebook tab's own status read)
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(url).pathname;
  const json = path === "/fb/sendall/status" ? { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [] } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});

function Screen({ buyers, sessionPlatform, sessionId = CUR, pastSessions = true, lang = "en" }: { buyers: Buyer[]; sessionPlatform: InvoicePlatform | null; sessionId?: string | null; pastSessions?: boolean; lang?: (typeof LANGS)[number] }) {
  return (
    <TProvider lang={lang}>
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyers} sessionKey={sessionId || "day:2026-11-27"} sessionId={sessionId} pastSessions={pastSessions}
          sessionPlatform={sessionPlatform} sellerId="u1" todayId="2026-11-27" sessionStartedAt="2026-11-27T04:00:00.000Z" sessionWindowDays={1} tapGuardMs={0}
          onReceiptFormat={() => {}} fbSendAll={{ lang }} />
      </div>
    </TProvider>
  );
}
async function open(props: Parameters<typeof Screen>[0]) { render(<Screen {...props} />); await flush(); }

beforeEach(() => {
  DB.reset(); localStorage.clear(); __resetSessionPlatforms();   // a session's platform is remembered for the app's life
  DB.s.orders = [...TT_CUR, ...PAST];
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the platform rules (pure)", () => {
  it("the running session's platform = its orders' platform, else the ONE platform live, else none", () => {
    expect(currentSessionPlatform(buyersOf(TT_CUR), {})).toBe("tiktok");
    expect(currentSessionPlatform(buyersOf(FB_CUR), { tiktok: true })).toBe("facebook");   // the orders decide
    expect(currentSessionPlatform([], { facebook: true })).toBe("facebook");
    expect(currentSessionPlatform([], { shopee: true })).toBe("shopee");
    expect(currentSessionPlatform([], {})).toBeNull();
    expect(currentSessionPlatform([], { tiktok: true, facebook: true })).toBeNull();
  });
  it("'This session' belongs to its own platform's tab, or to every tab while it has no platform", () => {
    expect(sessionOnTab("tiktok", "tiktok")).toBe(true);
    expect(sessionOnTab("tiktok", "facebook")).toBe(false);
    expect(sessionOnTab(null, "tiktok")).toBe(true);
    expect(sessionOnTab(null, "facebook")).toBe(true);
  });
  it("each session's platform comes from ONE stored row; the list keeps only that platform's sessions", async () => {
    __resetSessionPlatforms();
    const m = await loadSessionPlatforms([TT1, TT2, FB1, FB2, "no-rows"]);
    expect([...m!.entries()]).toEqual([[TT1, "TikTok"], [TT2, "TikTok"], [FB1, "Facebook"], [FB2, "Facebook"], ["no-rows", null]]);
    const { data } = await DB.supabase.rpc("my_session_summaries");
    const all = summariesFromRpc(data as never, CUR);
    expect(sessionsOfPlatform(all, m!, "Facebook").map((s) => s.id)).toEqual([FB1, FB2]);
    expect(sessionsOfPlatform(all, m!, "TikTok").map((s) => s.id)).toEqual([TT1, TT2]);
    // asked again: nothing is read again (a session's platform never changes)
    const before = platformReads().length;
    await loadSessionPlatforms([TT1, FB1]);
    expect(platformReads().length).toBe(before);
  });
});

describe("a TikTok session is running", () => {
  it("TikTok tab: 'This session' + the TikTok sessions only", async () => {
    await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok" });
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/27");
    expect(qa("ivc-row").length).toBe(2);
    await openMenu();
    expect(q("ivc-session-current")).not.toBeNull();
    expect(items()).toEqual([TT1, TT2]);
  });
  it("Facebook tab: no 'This session'; it shows the newest Facebook session, its list = the Facebook sessions only", async () => {
    await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok" });
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/26" }));
    expect(qa("ivc-fb-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2"]);
    expect(q("ivc-fb-past-line")).not.toBeNull();
    await openMenu();
    expect(q("ivc-session-current")).toBeNull();
    expect(items()).toEqual([FB1, FB2]);
  });
  it("a pick on the Facebook tab does not change the TikTok tab (and the other way round)", async () => {
    await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok" });
    await tap("ivc-tab-facebook");
    await openMenu();
    fireEvent.click(qa("ivc-session-item").find((b) => b.getAttribute("data-session") === FB2)!);
    await flush();
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/22" }));
    await tap("ivc-tab-tiktok");
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/27");
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("0");
    await openMenu();
    fireEvent.click(qa("ivc-session-item").find((b) => b.getAttribute("data-session") === TT1)!);
    await flush();
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/25" }));
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/22" }));   // still FB2
    await tap("ivc-tab-tiktok");
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/25" }));   // still TT1
  });
  it("no Facebook session at all → 'No Facebook sessions yet.' (8 languages)", async () => {
    DB.s.orders = [...TT_CUR, ...PAST.filter((r) => r.platform !== "Facebook" || r.user_id !== "u1")];
    for (const lang of LANGS) {
      cleanup(); __resetSessionPlatforms();
      await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok", lang });
      await tap("ivc-tab-facebook");
      const tl = buildT(lang);
      expect(q("ivc-no-sessions")!.textContent).toBe(tpl(tl.rd_ivc_no_sessions, { p: "Facebook" }));
      expect(tl.rd_ivc_no_sessions).toContain("{p}");
      expect(q("ivc-session-btn")).toBeNull();
    }
  });
  it("the platform read fails → it says so, and Try again works", async () => {
    DB.s.failPlatformReads = true;
    await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok" });
    await tap("ivc-tab-facebook");
    expect(q("ivc-sessions-error")!.textContent).toContain(t.rd_psn_failed);
    expect(qa("ivc-fb-row").length).toBe(0);
    DB.s.failPlatformReads = false;
    await tap("ivc-sessions-retry");
    expect(qa("ivc-fb-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2"]);
  });
});

describe("a Facebook session is running", () => {
  it("Facebook tab: 'This session'; TikTok tab: the newest TikTok session, no 'This session'", async () => {
    DB.s.orders = [...FB_CUR, ...PAST];
    await open({ buyers: buyersOf(FB_CUR), sessionPlatform: "facebook" });
    expect(q("ivc-session-label")!.textContent).toBe(tpl(t.rd_psn_btn, { range: "11/25" }));   // TikTok tab opens on TT1
    expect(qa("ivc-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1"]);
    await openMenu();
    expect(q("ivc-session-current")).toBeNull();
    expect(items()).toEqual([TT1, TT2]);
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/27");
    expect(qa("ivc-fb-row").length).toBe(2);
    await openMenu();
    expect(q("ivc-session-current")).not.toBeNull();
    expect(items()).toEqual([FB1, FB2]);
  });
  it("live on Facebook with no order yet: 'This session' is on the Facebook tab only", async () => {
    DB.s.orders = [...PAST];
    await open({ buyers: [], sessionPlatform: currentSessionPlatform([], { facebook: true }) });
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("1");   // TikTok tab: a past TikTok session
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-label")!.textContent).toBe("This session · 11/27");
    expect(q("ivc-fb-empty")!.textContent).toBe(t.rd_ivc_fb_empty);
  });
});

describe("no orders and not live", () => {
  it("'This session' on every tab, each with 'No <platform> buyers in this session yet.'", async () => {
    DB.s.orders = [...PAST];
    await open({ buyers: [], sessionPlatform: null, sessionId: null });
    expect(q("ivc-session-label")!.textContent).toContain("This session");
    expect(q("ivc-empty")!.textContent).toBe(t.rd_ivc_empty);
    await openMenu();
    expect(q("ivc-session-current")).not.toBeNull();
    expect(items()).toEqual([TT1, TT2]);
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-label")!.textContent).toContain("This session");
    expect(q("ivc-fb-empty")!.textContent).toBe(t.rd_ivc_fb_empty);
    expect(q("ivc-fb-old")).toBeNull();                                  // not the "can't be sent from here" note
    await openMenu();
    expect(q("ivc-session-current")).not.toBeNull();
    expect(items()).toEqual([FB1, FB2]);
  });
  it("a real old session without a session id (it has Facebook buyers) still gets the 'can't be sent from here' note", async () => {
    await open({ buyers: buyersOf(FB_CUR), sessionPlatform: "facebook", sessionId: null, pastSessions: false });
    await tap("ivc-tab-facebook");
    expect(q("ivc-fb-old")!.textContent).toBe(t.rd_ivc_fb_old);
    expect(q("ivc-fb-empty")).toBeNull();
  });
  it("without the session picker (the Orders rule says no) a tab is exactly as before: this session only", async () => {
    await open({ buyers: buyersOf(TT_CUR), sessionPlatform: "tiktok", pastSessions: false });
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-btn")).toBeNull();
    expect(q("ivc-fb-empty")!.textContent).toBe(t.rd_ivc_fb_empty);
    expect(DB.s.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(platformReads().length).toBe(0);
  });
});

describe("the Orders tab is unchanged", () => {
  it("Orders lists EVERY session (TikTok and Facebook) and makes no platform read", async () => {
    DB.s.orders = [...TT_CUR, ...PAST];
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="₱" orders={[]} state="live" buyers={buyersOf(TT_CUR)} todayId="2026-11-27" sessionId={CUR} pastSessions sellerId="u1" /></TProvider>);
    await flush();
    await tap("ord-range");
    expect(DB.s.calls.filter((c) => c.op === "rpc").length).toBe(1);
    expect(platformReads().length).toBe(0);
    // newest first, both platforms: FB1 (11/26), TT1 (11/25), FB2 (11/22), TT2 (11/20)
    expect(qa("ord-session-item").map((b) => b.textContent)).toEqual([
      "Past session · 11/26 · 1 day", "Past session · 11/25 · 1 day", "Past session · 11/22 · 1 day", "Past session · 11/20 · 1 day",
    ]);
  });
  it("the Orders screen still calls the shared loader with two arguments (no platform)", () => {
    const src = readFileSync("src/redesign/screens/Orders.tsx", "utf8");
    expect(src).toMatch(/usePastSessions\(sessionsMode, sessionId\);/);
  });
});
