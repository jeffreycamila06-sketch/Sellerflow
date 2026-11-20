// FACEBOOK POST SALES — fix round 1 (2026-11-20), the app half:
//   2. a seller who does not pass the plan rule but HAS post orders → Posts opens VIEW-ONLY: their
//      post orders and My posts; no Sell on a post, Print new, Give, Edit or End now (one short line
//      says why); without post orders → "Posts 🔒" as before; the hook does nothing when asked
//   3. the waiting line shows waiting post buyers also while a live session runs
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ hasOrders: vi.fn(), create: vi.fn(), end: vi.fn(), update: vi.fn(), mark: vi.fn(), filters: [] as string[], sales: [] as unknown[], orders: [] as unknown[] }));
vi.mock("../fbPostSales", async (orig) => {
  const real = await orig<typeof import("../fbPostSales")>();
  return {
    ...real,
    hasAnyPostOrders: h.hasOrders, createPostSale: h.create, endPostSale: h.end, updatePostItem: h.update, markPostOrdersPrinted: h.mark,
    loadPostSales: async () => h.sales, loadPostOrders: async () => h.orders, loadPostWaitlistCounts: async () => new Map(),
  };
});
vi.mock("../../../supabase", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = () => q;
  q.is = (c: string, v: unknown) => { h.filters.push(`is:${c}=${String(v)}`); return q; };
  q.or = (f: string) => { h.filters.push(`or:${f}`); return q; };
  const eq = q.eq as (...a: unknown[]) => unknown;
  q.eq = (c: string, v: unknown) => { if (c === "session_id") h.filters.push(`eq:${c}=${String(v)}`); return eq(c, v); };
  q.order = () => q;
  q.limit = async () => ({ data: [], error: null });
  return { isSupabaseConfigured: true, supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) }, from: () => q } };
});

import { TProvider, REDESIGN_STRINGS } from "../../i18n";
import Orders, { type WaitlistUi } from "../../screens/Orders";
import type { PostsUi } from "../../screens/PostSales";
import { postSalesAccess, postItemStock, type PostSale, type PostOrder } from "../fbPostSales";
import { usePostSales, usePostOrdersExist } from "../usePostSales";
import { groupWaitlist, loadWaitlist, type WaitlistRow } from "../fbWaitlist";

const NOW = Date.parse("2026-11-20T02:00:00Z");
beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] }); for (const f of [h.hasOrders, h.create, h.end, h.update, h.mark]) f.mockReset(); h.filters.length = 0; h.sales = []; h.orders = []; });
afterEach(() => { vi.useRealTimers(); });

const base = { switchOn: true, isAdmin: false, hasKey: false, pageCount: 1, nowMs: NOW };
describe("2a. who gets the view-only Posts side", () => {
  it("plan rule fails + has post orders → readonly; no orders / not known yet → locked", () => {
    const fails = [{ plan: "free", planStatus: "active" }, { plan: "basic", planStatus: "active" }, { plan: "master", planStatus: "expired" },
      { plan: "pro", planStatus: "pending" }, { plan: "plus", planStatus: "active", planExpiry: new Date(NOW - 1000).toISOString() }];
    for (const f of fails) {
      expect(postSalesAccess({ ...base, ...f, hasOrders: true }), JSON.stringify(f)).toBe("readonly");
      expect(postSalesAccess({ ...base, ...f, hasOrders: false }), JSON.stringify(f)).toBe("locked");
      expect(postSalesAccess({ ...base, ...f, hasOrders: null }), JSON.stringify(f)).toBe("locked");
      expect(postSalesAccess({ ...base, ...f }), JSON.stringify(f)).toBe("locked");
    }
  });
  it("an active Plus / Pro / Master, admin and testers stay full; switch off / no Page stay none", () => {
    expect(postSalesAccess({ ...base, plan: "pro", planStatus: "active", hasOrders: true })).toBe("full");
    expect(postSalesAccess({ ...base, plan: "pro", planStatus: "active", hasOrders: false })).toBe("full");
    expect(postSalesAccess({ ...base, isAdmin: true, plan: "free", hasOrders: true })).toBe("full");
    expect(postSalesAccess({ ...base, hasKey: true, plan: "basic", hasOrders: true })).toBe("full");
    expect(postSalesAccess({ ...base, switchOn: false, plan: "free", hasOrders: true })).toBe("none");
    expect(postSalesAccess({ ...base, pageCount: 0, plan: "free", hasOrders: true })).toBe("none");
  });
});

describe("2b. usePostOrdersExist — one read, only when the plan rule fails", () => {
  it("not needed → no read; needed → one read for the user; the answer kept", async () => {
    h.hasOrders.mockResolvedValue(true);
    const { result, rerender } = renderHook(({ need, active }) => usePostOrdersExist("u1", need, active), { initialProps: { need: false, active: false } });
    expect(h.hasOrders).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ need: true, active: false });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ need: true, active: true });
    rerender({ need: true, active: false });
    expect(h.hasOrders).toHaveBeenCalledTimes(1);
  });
  it("a failed read → still null (locked); asked again when Orders opens; another user → asked again", async () => {
    h.hasOrders.mockResolvedValueOnce(null).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result, rerender } = renderHook(({ uid, active }) => usePostOrdersExist(uid, true, active), { initialProps: { uid: "u1", active: false } });
    await waitFor(() => expect(h.hasOrders).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
    rerender({ uid: "u1", active: true });
    await waitFor(() => expect(result.current).toBe(false));
    rerender({ uid: "u2", active: true });
    await waitFor(() => expect(result.current).toBe(true));
    expect(h.hasOrders).toHaveBeenCalledTimes(3);
  });
  it("no user → no read", () => {
    renderHook(() => usePostOrdersExist(null, true, true));
    expect(h.hasOrders).not.toHaveBeenCalled();
  });
});

const sale: PostSale = { id: 1, pageId: "P1", postId: "P1_1", postMessage: "Weekend sale", postPicture: null, mode: "code", startsAt: "2026-11-19T00:00:00Z", endsAt: "2026-11-26T00:00:00Z", status: "selling", createdAt: "2026-11-19T00:00:00Z",
  items: [{ id: 10, saleId: 1, productId: null, name: "Red dress", code: "A", price: 350, stock: 5, sold: 1 }] };
const order: PostOrder = { id: 7, saleId: 1, itemId: 10, buyerFbId: "B1", buyerName: "Ana Cruz", qty: 1, price: 350, commentId: "c1", commentText: "A", createdAt: "2026-11-19T05:00:00Z", printedAt: null };
const ui = (o: Partial<PostsUi> = {}): PostsUi => ({
  state: "ready", sales: [sale], orders: [order], waitlistCounts: new Map(), pages: [{ pageId: "P1", name: "My Shop" }], products: [], busy: false, note: null,
  onReload: vi.fn(), onPrintNew: vi.fn(), onCreate: vi.fn(async () => ({ ok: true as const, id: 2 })), onEnd: vi.fn(async () => true), onUpdateItem: vi.fn(async () => true),
  loadPosts: vi.fn(async () => ({ ok: true as const, posts: [] })), ...o,
});
const view = (extra: Record<string, unknown> = {}, lang = "en") => render(<TProvider lang={lang as "en"}><Orders onGoPrint={() => {}} cur="NT$" orders={[]} state="live" todayId="2026-11-20" buyers={[]} {...extra} /></TProvider>);
const openPosts = (u: PostsUi, lang = "en") => { view({ posts: u }, lang); fireEvent.click(screen.getByTestId("ord-seg-posts")); };

describe("2c. the view-only Posts side", () => {
  it("shows the post orders + the one line; Print new is off and does nothing", () => {
    const u = ui({ readOnly: true });
    openPosts(u);
    expect(screen.getByTestId("posts-readonly").textContent).toContain("Posts isn't on your current plan — view only. Contact support to learn more.");
    expect(screen.getAllByTestId("posts-buyer-card")).toHaveLength(1);
    expect(screen.getByText("Ana Cruz")).toBeTruthy();
    const pn = screen.getByTestId("posts-print-new") as HTMLButtonElement;
    expect(pn.disabled).toBe(true);
    expect(pn.getAttribute("aria-describedby")).toBe("posts-readonly");
    fireEvent.click(pn);
    expect(u.onPrintNew).not.toHaveBeenCalled();
  });
  it("My posts: the posts and counts are there; no Sell on a post, no Edit, no End now", () => {
    openPosts(ui({ readOnly: true }));
    fireEvent.click(screen.getByTestId("posts-my-btn"));
    expect(screen.queryByTestId("my-posts-sell")).toBeNull();
    expect(screen.getByTestId("posts-readonly")).toBeTruthy();
    expect(screen.getAllByTestId("my-post-card")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("my-post-toggle"));
    expect(screen.getAllByTestId("my-post-item")).toHaveLength(1);
    expect(screen.queryByTestId("my-post-edit")).toBeNull();
    expect(screen.queryByTestId("my-post-end")).toBeNull();
  });
  it("no orders left: no Sell button in the empty state, My posts still opens", () => {
    openPosts(ui({ readOnly: true, orders: [] }));
    expect(screen.getByTestId("posts-empty")).toBeTruthy();
    expect(screen.queryByTestId("posts-sell-btn")).toBeNull();
    expect(screen.getByTestId("posts-my-link")).toBeTruthy();
  });
  it("NOT read-only (an active plan) → everything as before", () => {
    const u = ui();
    openPosts(u);
    expect(screen.queryByTestId("posts-readonly")).toBeNull();
    fireEvent.click(screen.getByTestId("posts-print-new"));
    expect(u.onPrintNew).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("posts-my-btn"));
    expect(screen.getByTestId("my-posts-sell")).toBeTruthy();
    fireEvent.click(screen.getByTestId("my-post-toggle"));
    expect(screen.getByTestId("my-post-edit")).toBeTruthy();
    expect(screen.getByTestId("my-post-end")).toBeTruthy();
  });
  it("the line in Traditional Chinese", () => {
    openPosts(ui({ readOnly: true }), "zh-TW");
    expect(screen.getByTestId("posts-readonly").textContent).toContain("貼文不在你目前的方案內 — 僅可查看。");
  });
  it("both new texts are filled in all 8 languages", () => {
    for (const k of ["rd_fps_readonly", "rd_wl_post_off"] as const)
      for (const lang of Object.keys(REDESIGN_STRINGS) as (keyof typeof REDESIGN_STRINGS)[]) expect((REDESIGN_STRINGS[lang] as Record<string, string>)[k], `${lang}.${k}`).toBeTruthy();
  });
});

describe("2d. usePostSales readOnly — the actions do nothing (the database refuses them too)", () => {
  const texts = { printed: () => "", nothingNew: "", started: "", printFailed: "" };
  it("Sell / End now / Edit / Print new: no database call, no print (a NEW order is waiting)", async () => {
    h.sales = [sale]; h.orders = [order];                // one buyer with an unprinted post order
    const print = vi.fn(() => true);
    const { result } = renderHook(() => usePostSales({ enabled: true, active: true, readOnly: true, pages: [], print, texts }));
    await waitFor(() => expect(result.current?.state).toBe("ready"));
    expect(result.current?.readOnly).toBe(true);
    expect(await result.current!.onCreate({ pageId: "P1", postId: "x", postMessage: "", postPicture: "", mode: "code", endsAt: "", items: [] })).toEqual({ ok: false, error: "not_allowed" });
    expect(await result.current!.onEnd(1)).toBe(false);
    expect(await result.current!.onUpdateItem(10, 1, 1)).toBe(false);
    result.current!.onPrintNew();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.end).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.mark).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });
  it("not read-only → the calls go through as before (Print new prints the waiting order)", async () => {
    h.end.mockResolvedValue(true); h.update.mockResolvedValue(true); h.create.mockResolvedValue({ ok: true, id: 3 }); h.mark.mockResolvedValue(true);
    h.sales = [sale]; h.orders = [order];
    const print = vi.fn(() => true);
    const { result } = renderHook(() => usePostSales({ enabled: true, active: true, pages: [], print, texts }));
    await waitFor(() => expect(result.current?.state).toBe("ready"));
    expect(result.current?.readOnly).toBe(false);
    result.current!.onPrintNew();
    expect(print).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.mark).toHaveBeenCalledWith([7]));
    await result.current!.onEnd(1); await result.current!.onUpdateItem(10, 1, 1);
    await result.current!.onCreate({ pageId: "P1", postId: "x", postMessage: "", postPicture: "", mode: "code", endsAt: "", items: [] });
    expect([h.end.mock.calls.length, h.update.mock.calls.length, h.create.mock.calls.length]).toEqual([1, 1, 1]);
  });
});

const wl = (o: Partial<WaitlistRow>): WaitlistRow => ({ id: 1, sessionId: null, code: "A", productLocalId: null, commentId: "c1", pageId: "P1", liveVideoId: null, commenterId: "B1", commenterName: "Ana", handle: "B1", createdAt: "2026-11-20T01:00:00Z", status: "waiting", source: "post", saleId: 1, ...o });
describe("2e. Give for post buyers is off without the plan; live buyers unchanged", () => {
  it("post group: Give off + the line; live group: Give works", () => {
    const groups = groupWaitlist([wl({ id: 1 }), wl({ id: 2, commentId: "c2", source: "live", saleId: null, code: "B", sessionId: "s1" })]);
    const onGive = vi.fn();
    const w: WaitlistUi = { state: "ready", groups, stockFor: () => 3, onGive, onSkip: vi.fn(), busyId: null, postGiveOff: true };
    view({ waitlist: w });
    expect(screen.getByTestId("waitlist-post-off").textContent).toContain("Posts isn't on your current plan — Give is off for post buyers.");
    const post = screen.getByTestId("waitlist-give-1") as HTMLButtonElement, live = screen.getByTestId("waitlist-give-2") as HTMLButtonElement;
    expect(post.disabled).toBe(true);
    fireEvent.click(post);
    expect(onGive).not.toHaveBeenCalled();
    expect(live.disabled).toBe(false);
    fireEvent.click(live);
    expect(onGive).toHaveBeenCalledTimes(1);
  });
  it("with the plan: no line, post Give on", () => {
    const w: WaitlistUi = { state: "ready", groups: groupWaitlist([wl({ id: 1 })]), stockFor: () => 3, onGive: vi.fn(), onSkip: vi.fn(), busyId: null, postGiveOff: false };
    view({ waitlist: w });
    expect(screen.queryByTestId("waitlist-post-off")).toBeNull();
    expect((screen.getByTestId("waitlist-give-1") as HTMLButtonElement).disabled).toBe(false);
  });
  it("a post whose end date passed (End now leaves it 'selling' until its comments are read) gives no stock", () => {
    const ended = { ...sale, endsAt: new Date(NOW - 1000).toISOString() };
    expect(postItemStock([ended], "A", 1)).toBe(0);
    expect(postItemStock([ended], "A")).toBe(0);
    expect(postItemStock([sale], "A", 1)).toBe(4);
    expect(postItemStock([{ ...sale, endsAt: new Date(NOW).toISOString() }], "A", 1)).toBe(0); // the end moment itself = ended
  });
  it("RedesignApp: read-only wiring; Give on a post row stops before the database call without the plan", () => {
    const app = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(app).toContain('const postHasOrders = usePostOrdersExist(auth.status === "authed" ? auth.profile?.authUserId : null, postSalesAccess(postPlan) === "locked", screen === "orders");');
    expect(app).toContain("const postAccess = postSalesAccess({ ...postPlan, hasOrders: postHasOrders });");
    expect(app).toContain('postGiveOff: postAccess !== "full"');
    const i = app.indexOf('if (r.source === "post") {');
    const guard = app.indexOf('if (postAccess !== "full") { setWlNote(tApp.rd_wl_post_off); return; }', i);
    expect(guard).toBeGreaterThan(i);
    expect(guard).toBeLessThan(app.indexOf("givePostWaitlist(r.id)", i));
  });
});

describe("3. the waiting line during a live session also shows waiting post buyers", () => {
  it("a session → this session's rows OR post rows; no session → the rows without a session (as before)", async () => {
    await loadWaitlist("3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(h.filters).toEqual(["or:session_id.eq.3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b,source.eq.post"]);
    h.filters.length = 0;
    await loadWaitlist(null);
    expect(h.filters).toEqual(["is:session_id=null"]);
  });
  it("a session id that is not a uuid is never put into the filter text (old exact match)", async () => {
    await loadWaitlist("x,source.eq.live");
    expect(h.filters).toEqual(["eq:session_id=x,source.eq.live"]);
  });
});
