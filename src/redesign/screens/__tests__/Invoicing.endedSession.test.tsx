// Invoicing → Facebook after the session has ENDED (no current session id) while its Facebook buyers are still
// on screen: the Facebook tab opens on that ended session from the list (the newest Facebook session) — Send
// all works there — instead of "This session can't be sent from here." Pins: the picker shows the ended session
// (amber, no "This session"), the status read is for that session's id, its buyers are listed; no Facebook
// session in the list → today's note; without the session picker → today's note; the TikTok tab and a running
// session with an id are unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});

import { TProvider, buildT } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB, type FakeOrderRow } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer } from "../../../lib/orderTypes";
import { __resetSessionPlatforms } from "../../adapters/pastSessions";

const t = buildT("en");
const ENDED = "b0000000-0000-4000-8000-000000000031";   // the session that just ended (its id is gone from the config)
const FB_OLD = "b0000000-0000-4000-8000-000000000032";
const TT_OLD = "a0000000-0000-4000-8000-000000000041";
const CUR = "c0000000-0000-4000-8000-000000000001";
const row = (sid: string, at: string, n: number, handle: string, platform: string, product = "Item", price = 100): FakeOrderRow =>
  ({ user_id: "u1", session_id: sid, session_date: at.slice(0, 10), created_at: at, buyer_number: n, handle, customer_name: handle, platform, product, price, qty: 1, comment_msg_id: null, auto_code: null });
const ENDED_ROWS = [row(ENDED, "2026-11-27T05:00:00.000Z", 1, "Fe Cruz", "Facebook", "Dress", 350), row(ENDED, "2026-11-27T05:02:00.000Z", 2, "Gil Ong", "Facebook", "Bag", 120)];
const OLDER = [row(FB_OLD, "2026-11-22T05:00:00.000Z", 1, "Flo Sy", "Facebook"), row(TT_OLD, "2026-11-25T05:00:00.000Z", 1, "@tia", "TikTok")];
const buyersOf = (rows: FakeOrderRow[]): Buyer[] => rebuildSessionFromRows(rows as unknown as LiveSessionRow[]).buyers;

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const qa = (id: string) => Array.from(document.querySelectorAll(`[data-testid='${id}']`)) as HTMLElement[];
const flush = async () => { for (let i = 0; i < 16; i++) await act(async () => { await Promise.resolve(); }); };
const tap = async (id: string) => { fireEvent.click(q(id)!); await flush(); };
const statusCalls: string[] = [];
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  if (path === "/fb/sendall/status") statusCalls.push(JSON.parse(init.body).sessionId);
  const json = path === "/fb/sendall/status" ? { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [] } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});
async function open({ buyers, sessionId = null, pastSessions = true, sessionPlatform = "facebook" as const }: { buyers: Buyer[]; sessionId?: string | null; pastSessions?: boolean; sessionPlatform?: "facebook" | "tiktok" }) {
  render(
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyers} sessionKey={sessionId || "day:2026-11-27"} sessionId={sessionId} pastSessions={pastSessions}
          sessionPlatform={sessionPlatform} sellerId="u1" todayId="2026-11-27" sessionStartedAt="2026-11-27T04:00:00.000Z" sessionWindowDays={1} tapGuardMs={0}
          onReceiptFormat={() => {}} fbSendAll={{ lang: "en" }} />
      </div>
    </TProvider>,
  );
  await flush();
}
beforeEach(() => { DB.reset(); localStorage.clear(); __resetSessionPlatforms(); statusCalls.length = 0; vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the session ended, its Facebook buyers are on screen", () => {
  it("the Facebook tab opens on that ended session (newest Facebook session): picker amber, Send all for its id, its buyers", async () => {
    DB.s.orders = [...ENDED_ROWS, ...OLDER];
    await open({ buyers: buyersOf(ENDED_ROWS) });
    await tap("ivc-tab-facebook");
    expect(q("ivc-fb-old")).toBeNull();
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("1");
    expect(statusCalls).toContain(ENDED);
    expect(statusCalls.every((id) => id === ENDED)).toBe(true);
    expect(qa("ivc-fb-row").map((r) => r.getAttribute("data-buyer"))).toEqual(["1", "2"]);
    expect(q("ivc-fb-send-all")).not.toBeNull();
    await tap("ivc-session-btn");
    expect(q("ivc-session-current")).toBeNull();          // no "This session" (it has no id to send from)
    expect(qa("ivc-session-item").map((b) => b.getAttribute("data-session"))).toEqual([ENDED, FB_OLD]);
  });
  it("no Facebook session in the list → today's 'can't be sent from here' note", async () => {
    DB.s.orders = [OLDER[1]];
    await open({ buyers: buyersOf(ENDED_ROWS) });
    await tap("ivc-tab-facebook");
    expect(q("ivc-fb-old")!.textContent).toBe(t.rd_ivc_fb_old);
    expect(statusCalls).toEqual([]);
  });
  it("without the session picker (the Orders rule says no) → today's note", async () => {
    DB.s.orders = [...ENDED_ROWS, ...OLDER];
    await open({ buyers: buyersOf(ENDED_ROWS), pastSessions: false });
    await tap("ivc-tab-facebook");
    expect(q("ivc-fb-old")!.textContent).toBe(t.rd_ivc_fb_old);
  });
  it("a running Facebook session with an id: 'This session' as before", async () => {
    const rows = ENDED_ROWS.map((r) => ({ ...r, session_id: CUR }));
    DB.s.orders = [...rows, ...OLDER];
    await open({ buyers: buyersOf(rows), sessionId: CUR });
    await tap("ivc-tab-facebook");
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("0");
    expect(statusCalls.every((id) => id === CUR)).toBe(true);
  });
  it("the TikTok tab is unchanged (its own newest session, as before)", async () => {
    DB.s.orders = [...ENDED_ROWS, ...OLDER];
    await open({ buyers: buyersOf(ENDED_ROWS) });
    expect(q("ivc-session-btn")!.getAttribute("data-past")).toBe("1");
    await tap("ivc-session-btn");
    expect(qa("ivc-session-item").map((b) => b.getAttribute("data-session"))).toEqual([TT_OLD]);
  });
});
