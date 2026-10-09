// F3 — Facebook waitlist. Pins: grouping (per code, oldest first), the rebuilt comment runs
// through the REAL order payload builders as a Facebook comment (comment_msg_id + page meta,
// buyer numbering by handle — the order hub itself unchanged), the same-name warning rule,
// the Orders section (absent without the prop; next in line only when back in stock; Give /
// Skip), the RedesignApp Give path (sync guard, createOrder with NO autoCode / productLocalId,
// failure keeps the buyer waiting, a 'waitlist' stock log, no message), joining the line
// before the sold-out message, and the sql/92 contract.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { groupWaitlist, rebuildWaitlistComment, nameHasBuyer, mapWaitlistRow, type WaitlistRow } from "../fbWaitlist";
import { liveSessionPayload, orderDbPayload } from "../useOrders";
import { buildOrderFromComment } from "../../../lib/orderLogic";
import { TProvider } from "../../i18n";
import Orders, { type WaitlistUi } from "../../screens/Orders";

const row = (o: Partial<WaitlistRow>): WaitlistRow => ({
  id: 1, sessionId: "s1", code: "A1", productLocalId: 7, commentId: "100_1", pageId: "555", liveVideoId: "LV", commenterId: "C9",
  commenterName: "Ana Cruz", handle: "Ana Cruz", createdAt: "2026-10-08T03:00:00Z", status: "waiting", ...o,
});

describe("pure helpers", () => {
  it("groups by code (case-insensitive), oldest first; given/skipped rows dropped", () => {
    const g = groupWaitlist([
      row({ id: 3, code: "a1", createdAt: "2026-10-08T03:02:00Z" }),
      row({ id: 1, code: "A1", createdAt: "2026-10-08T03:00:00Z" }),
      row({ id: 2, code: "B2", createdAt: "2026-10-08T03:01:00Z" }),
      row({ id: 4, code: "A1", status: "given" }),
    ]);
    expect(g.map((x) => [x.code, x.rows.map((r) => r.id)])).toEqual([["A1", [1, 3]], ["B2", [2]]]);
  });
  it("same-name rule", () => {
    expect(nameHasBuyer("Ana Cruz", [{ name: "ana cruz" }])).toBe(true);
    expect(nameHasBuyer("Ana Cruz", [{ name: "Ben" }, { handle: "x" }])).toBe(false);
    expect(nameHasBuyer("", [{ name: "" }])).toBe(false);
  });
  it("status is guarded", () => {
    expect(mapWaitlistRow({ id: 1, status: "weird" }).status).toBe("waiting");
  });
});

describe("Give: the rebuilt comment through the REAL order builders", () => {
  it("Facebook order with comment_msg_id + page meta, numbered by handle", () => {
    const c = rebuildWaitlistComment(row({}));
    expect(c).toMatchObject({ platform: "Facebook", comment: "A1", msgId: "100_1", pageId: "555", handle: "Ana Cruz", name: "Ana Cruz" });
    const buyers = [{ num: 4, handle: "Ana Cruz", name: "Ana Cruz", platform: "Facebook", orders: [], totalSpent: 0, totalOrders: 0 }] as never;
    const { order } = buildOrderFromComment(c, buyers, 150, new Date(1_760_000_000_000)) as unknown as { order: Parameters<typeof liveSessionPayload>[1] & { bNum: number } };
    expect(order.bNum).toBe(4);                                 // joins the existing buyer number
    const lso = liveSessionPayload(c, { ...order, item: "A1" }, "2026-10-08", "s1") as Record<string, unknown>;
    expect(lso.platform).toBe("Facebook");
    expect(lso.comment_msg_id).toBe("100_1");
    expect(lso.platform_meta).toEqual({ page_id: "555", live_video_id: "LV", commenter_id: "C9" });
    expect(lso.auto_code ?? null).toBeNull();                   // never an auto order
    expect(orderDbPayload(c, { ...order, item: "A1" })).toMatchObject({ customer_name: "Ana Cruz", product: "A1" });
  });
});

describe("Orders section", () => {
  const ui = (o: Partial<WaitlistUi> = {}): WaitlistUi => ({
    state: "ready", groups: groupWaitlist([row({ id: 1 }), row({ id: 2, commenterName: "Ben", createdAt: "2026-10-08T03:05:00Z" })]),
    stockFor: () => 1, onGive: vi.fn(), onSkip: vi.fn(), busyId: null, note: null, ...o,
  });
  const view = (extra: Record<string, unknown> = {}) =>
    render(<TProvider lang="en"><Orders onGoPrint={() => {}} cur="NT$" orders={[]} state="live" todayId="2026-10-08" buyers={[]} {...extra} /></TProvider>);
  it("no prop → no section; no rows → no section", () => {
    const a = view().container.innerHTML;
    expect(a).not.toContain("waitlist");
    expect(view({ waitlist: ui({ groups: [] }) }).container.innerHTML).toBe(a);
  });
  it("back in stock: the oldest is next in line; Give / Skip report the row", () => {
    const w = ui();
    view({ waitlist: w });
    expect(screen.getByTestId("waitlist-row-1").textContent).toContain("next in line");
    expect(screen.getByTestId("waitlist-row-2").textContent).not.toContain("next in line");
    fireEvent.click(screen.getByTestId("waitlist-give-1"));
    expect(w.onGive).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.click(screen.getByTestId("waitlist-skip-2"));
    expect(w.onSkip).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });
  it("still sold out: nobody is next and Give is disabled", () => {
    view({ waitlist: ui({ stockFor: () => 0 }) });
    expect(screen.queryByTestId("waitlist-next")).toBeNull();
    expect((screen.getByTestId("waitlist-give-1") as HTMLButtonElement).disabled).toBe(true);
  });
  it("error and note are shown", () => {
    view({ waitlist: ui({ state: "error", groups: [], note: "x" }) });
    expect(screen.getByTestId("waitlist-error")).toBeTruthy();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const body = (name: string) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf("\n  };", i)); };
  it("gate: own switch + fbAccess.receipt + fbEnabled + Facebook world", () => {
    expect(src).toContain('const waitlistBase = soldoutGate({ flag: featureSw.fbWaitlist, receiptAccess: fbAccess.receipt, fbEnabled, hidden: platformHides("fbWaitlist", world) });');
  });
  it("Give: sync guard BEFORE createOrder, no autoCode / productLocalId, failure keeps waiting, 'waitlist' log, no message", () => {
    const b = body("onWaitlistGive");
    const guard = b.indexOf("wlGiveRef.current.add(r.id)"), create = b.indexOf("orders.createOrder(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(create);
    expect(b).toContain("orders.createOrder(c, effectiveOrderPrice(code ? code.price : 0, samePriceCfg.active), { itemOverride: code ? code.code : r.code });");
    expect(b).not.toMatch(/autoCode:|productLocalId:/);
    // Build 11 (M13): a refused order gives the taken piece back, then keeps the buyer waiting
    expect(b).toContain("if (taken && lid != null) void adjustProductStock(lid, 1)");
    expect(b).toContain("wlGiveRef.current.delete(r.id); setWlNote(tApp.rd_wl_give_failed); return;");
    expect(b).toContain('adjustStockLogged(lid, -1, "waitlist", r.commentId)');
    expect(b).toContain('setWaitlistStatus(r.id, "given")');
    expect(b).not.toMatch(/sendSoldOut|soldout\/send/);
    expect(b).toContain("nameHasBuyer(who, liveSession.session.buyers)");
  });
  it("joins the line after the DB stock check and BEFORE the sold-out message (position)", () => {
    const b = body("onSoldOutFacebook");
    const [st, jn, sd] = ["loadProductStock(", "joinWaitlist(", "sendSoldOut("].map((x) => b.indexOf(x));
    expect(st).toBeGreaterThan(-1);
    expect(jn).toBeGreaterThan(st);
    expect(sd).toBeGreaterThan(jn);
    expect(b).toContain("await sendSoldOut({ ...target, code: code.code, lang, position });");
  });
});

describe("sql/92 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql", "92_fb_waitlist.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("own RLS, unique per comment, status-only updates, 10-day purge, invoker join", () => {
    expect(code).toContain("create unique index if not exists fb_waitlist_user_comment on public.fb_waitlist (user_id, comment_id)");
    expect(code).toContain("grant update (status) on public.fb_waitlist to authenticated");
    expect(code).toContain("interval '10 days'");
    expect(code).toContain("security invoker");
    expect(code).not.toMatch(/security definer/i);
    expect(code).toContain("'auto_order', 'oneclick', 'restock', 'manual_edit', 'waitlist'");
  });
  it("rollback keeps old log rows (not valid), plain drops", () => {
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "92_fb_waitlist_rollback.sql"), "utf8");
    expect(rb).not.toMatch(/if exists/i);
    expect(rb).toContain("not valid;");
    expect(rb).not.toMatch(/delete from public\.stock_movements/);
  });
});
