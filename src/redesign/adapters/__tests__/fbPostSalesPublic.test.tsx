// FACEBOOK POST SALES for every paid seller (2026-11-20, sql/188) — the app half:
//   A. the access rule: Plus / Pro / Master active + not past expiry → the Posts side; admin and the
//      'fb_post_sales' key whatever the plan; Free / Basic / expired / pending → "Posts 🔒"
//   B. Orders with "Posts 🔒": the segment shows the lock, a tap calls the contact-support popup and
//      the screen stays on Live; no dot
//   C. the end-date picker: 7 days at first, − / + by one day, 1..14 only, the date shown; Start sends
//      now + N days; the two new database answers have their own sentence
//   D. waitlist: two "+1" posts are two groups, each with its own stock and post text; Give's stock
//      looks at the waiting comment's own post
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TProvider, REDESIGN_STRINGS } from "../../i18n";
import Orders, { type WaitlistUi } from "../../screens/Orders";
import type { PostsUi } from "../../screens/PostSales";
import { postSalesAccess, clampSaleDays, saleEndsAt, postItemStock, POST_SALE_MAX_DAYS, POST_SALE_DEFAULT_DAYS, type PostSale } from "../fbPostSales";
import { groupWaitlist, mapWaitlistRow, type WaitlistRow } from "../fbWaitlist";

const NOW = Date.parse("2026-11-20T02:00:00Z"); // 10:00 Taipei
beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

const base = { switchOn: true, isAdmin: false, hasKey: false, pageCount: 1, nowMs: NOW };
describe("A. who gets the Posts side", () => {
  it("Plus / Pro / Master, active, not past expiry → full (case and spaces ignored)", () => {
    for (const plan of ["plus", "pro", "master", "Plus", " PRO ", "Master"]) {
      expect(postSalesAccess({ ...base, plan, planStatus: "active", planExpiry: null }), plan).toBe("full");
      expect(postSalesAccess({ ...base, plan, planStatus: "active", planExpiry: new Date(NOW + 3600_000).toISOString() }), plan).toBe("full");
    }
  });
  it("Free / Basic / no plan / expired / pending / past expiry → locked", () => {
    for (const plan of ["free", "basic", "Basic", "", null, "trial", "enterprise"]) expect(postSalesAccess({ ...base, plan, planStatus: "active" }), String(plan)).toBe("locked");
    expect(postSalesAccess({ ...base, plan: "master", planStatus: "expired" })).toBe("locked");
    expect(postSalesAccess({ ...base, plan: "pro", planStatus: "pending" })).toBe("locked");
    expect(postSalesAccess({ ...base, plan: "plus", planStatus: "active", planExpiry: new Date(NOW - 1000).toISOString() })).toBe("locked");
  });
  it("admin and the 'fb_post_sales' key → full whatever the plan; switch off / no Page → none", () => {
    expect(postSalesAccess({ ...base, isAdmin: true, plan: "free" })).toBe("full");
    expect(postSalesAccess({ ...base, hasKey: true, plan: "basic", planStatus: "expired" })).toBe("full");
    expect(postSalesAccess({ ...base, switchOn: false, plan: "pro", planStatus: "active" })).toBe("none");
    expect(postSalesAccess({ ...base, pageCount: 0, plan: "pro", planStatus: "active" })).toBe("none");
    expect(postSalesAccess({ ...base, pageCount: 0, plan: "free" })).toBe("none");
  });
});

const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Orders onGoPrint={() => {}} cur="NT$" orders={[]} state="live" todayId="2026-11-20" buyers={[]} {...extra} /></TProvider>);

describe("B. Orders with Posts 🔒", () => {
  it("segment with a lock; tap → the popup callback, the screen stays on Live; no dot; nothing about posts loads", () => {
    const onLocked = vi.fn();
    view({ postsLocked: true, onPostsLocked: onLocked });
    const tab = screen.getByTestId("ord-seg-posts");
    expect(tab.textContent).toContain("Posts");
    expect(screen.getByTestId("ord-posts-lock").textContent).toBe("🔒");
    expect(tab.getAttribute("aria-label")).toBe("Posts — not on your current plan");
    expect(screen.queryByTestId("ord-posts-dot")).toBeNull();
    fireEvent.click(tab);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("posts-body")).toBeNull();
    expect(screen.getByTestId("ord-seg-live").getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(window.localStorage.getItem("sfl_rd_posts_seen")).toBeNull(); // the "seen" mark is for the real Posts side
  });
  it("no posts and no lock → no segment (switch off / no Page = as before)", () => {
    view();
    expect(screen.queryByTestId("ord-live-posts")).toBeNull();
  });
  it("RedesignApp: locked → postsLocked + the SAME contact-support popup as Pickup Status; full → the Posts side", () => {
    const app = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(app).toContain('postAccess === "locked" ? { postsLocked: true, onPostsLocked: () => setUpsellOpen(true) }');
    expect(app).toContain('enabled: postAccess === "full" || postAccess === "readonly", readOnly: postAccess === "readonly", active: screen === "orders"');
    expect(app).toMatch(/upsellOpen && \(\s*<ContactSupportPopup\s*title=\{tApp\.rd_lock_title\}\s*message=\{tApp\.rd_lock_body\}/);
    expect(app).toContain('v === "not_allowed" ? tApp.rd_lock_body');
  });
});

const ui = (o: Partial<PostsUi> = {}): PostsUi => ({
  state: "ready", sales: [], orders: [], waitlistCounts: new Map(), pages: [{ pageId: "P1", name: "My Shop" }], products: [], busy: false, note: null,
  onReload: vi.fn(), onPrintNew: vi.fn(), onCreate: vi.fn(async () => ({ ok: true as const, id: 2 })), onEnd: vi.fn(async () => true), onUpdateItem: vi.fn(async () => true),
  loadPosts: vi.fn(async () => ({ ok: true as const, posts: [{ id: "P1_9", message: "New arrivals", createdTime: "2026-11-19T10:00:00Z", picture: "", url: "" }] })), ...o,
});
async function openForm(u: PostsUi) {
  view({ posts: u });
  fireEvent.click(screen.getByTestId("ord-seg-posts"));
  fireEvent.click(screen.getByTestId("posts-sell-btn"));
  fireEvent.click(await screen.findByTestId("sell-post-row"));
  fireEvent.change(screen.getByTestId("sell-item-name"), { target: { value: "Red dress" } });
  fireEvent.change(screen.getByTestId("sell-item-code"), { target: { value: "A" } });
  fireEvent.change(screen.getByTestId("sell-item-price"), { target: { value: "350" } });
}

describe("C. the end-date picker", () => {
  it("7 days at first with the date; + to 14 then +  is off; − to 1 then − is off; the old free date box is gone", async () => {
    await openForm(ui());
    expect(screen.getByTestId("sell-days").textContent).toBe("7 days");
    expect(screen.getByTestId("sell-ends-date").textContent).toBe("Nov 27, 10:00");
    expect(screen.getByTestId("sell-ends-max").textContent).toBe("Up to 14 days.");
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    const more = screen.getByTestId("sell-days-more") as HTMLButtonElement, less = screen.getByTestId("sell-days-less") as HTMLButtonElement;
    for (let i = 0; i < 10; i++) fireEvent.click(more);
    expect(screen.getByTestId("sell-days").textContent).toBe("14 days");
    expect(screen.getByTestId("sell-ends-date").textContent).toBe("Dec 4, 10:00");
    expect(more.disabled).toBe(true);
    for (let i = 0; i < 20; i++) fireEvent.click(less);
    expect(screen.getByTestId("sell-days").textContent).toBe("1 day");
    expect(less.disabled).toBe(true);
    expect(more.getAttribute("aria-label")).toBe("One day more");
    expect(less.getAttribute("aria-label")).toBe("One day less");
    for (const b of [more, less]) { expect(b.style.width).toBe("44px"); expect(b.style.height).toBe("44px"); } // tap size
  });
  it("Start sends now + the chosen days (7 by default, 14 at most)", async () => {
    const u = ui();
    await openForm(u);
    fireEvent.click(screen.getByTestId("sell-start"));
    await vi.waitFor(() => expect(u.onCreate).toHaveBeenCalledTimes(1));
    expect((u.onCreate as ReturnType<typeof vi.fn>).mock.calls[0][0].endsAt).toBe(new Date(NOW + 7 * 86400000).toISOString());
  });
  it("the database answers 'ends_too_late' / 'ends_in_past' → their own sentence", async () => {
    for (const [error, text] of [["ends_too_late", "The end date can be at most 14 days from now."], ["ends_in_past", "The end date must be in the future."]] as const) {
      const u = ui({ onCreate: vi.fn(async () => ({ ok: false as const, error })) });
      const { unmount } = render(<></>);
      await openForm(u);
      fireEvent.click(screen.getByTestId("sell-start"));
      expect((await screen.findByTestId("sell-error")).textContent).toBe(text);
      unmount();
      document.body.innerHTML = "";
    }
  });
  it("pure: clampSaleDays 1..14, junk → 7; saleEndsAt", () => {
    expect([0, 1, 7, 14, 15, 99, -3, NaN, 6.6].map(clampSaleDays)).toEqual([7, 1, 7, 14, 14, 14, 7, 7, 7]);
    expect(saleEndsAt(14, NOW)).toBe(new Date(NOW + 14 * 86400000).toISOString());
    expect(saleEndsAt(30, NOW)).toBe(new Date(NOW + 14 * 86400000).toISOString());
    expect([POST_SALE_DEFAULT_DAYS, POST_SALE_MAX_DAYS]).toEqual([7, 14]);
  });
  it("every new text is filled in all 8 languages", () => {
    for (const k of ["rd_fps_day_1", "rd_fps_day_less", "rd_fps_day_more", "rd_fps_ends_max", "rd_fps_err_ends_late", "rd_fps_err_ends_past", "rd_fps_tab_locked_aria"] as const)
      for (const lang of Object.keys(REDESIGN_STRINGS) as (keyof typeof REDESIGN_STRINGS)[]) expect((REDESIGN_STRINGS[lang] as Record<string, string>)[k], `${lang}.${k}`).toBeTruthy();
    expect(Object.keys(REDESIGN_STRINGS)).toHaveLength(8);
  });
});

const plusSale = (id: number, name: string, stock: number | null, sold: number): PostSale => ({
  id, pageId: "P1", postId: `P1_${id}`, postMessage: name, postPicture: null, mode: "plus_one", startsAt: "2026-11-19T00:00:00Z", endsAt: "2026-11-26T00:00:00Z",
  status: "selling", createdAt: `2026-11-19T0${id}:00:00Z`, items: [{ id: id * 10, saleId: id, productId: null, name, code: "+1", price: 100, stock, sold }],
});
const wl = (o: Partial<WaitlistRow>): WaitlistRow => ({ id: 1, sessionId: null, code: "+1", productLocalId: null, commentId: "c1", pageId: "P1", liveVideoId: null, commenterId: "B1", commenterName: "Ana", handle: "B1", createdAt: "2026-11-20T01:00:00Z", status: "waiting", source: "post", saleId: null, ...o });

describe("D. waitlist: each post is its own line", () => {
  it("the row keeps sale_id (post rows only)", () => {
    expect(mapWaitlistRow({ id: 1, code: "+1", source: "post", sale_id: "7", status: "waiting" }).saleId).toBe(7);
    expect(mapWaitlistRow({ id: 1, code: "+1", source: "post", status: "waiting" }).saleId).toBeNull();      // before sql/188
    expect(mapWaitlistRow({ id: 1, code: "A", source: "live", sale_id: 7, status: "waiting" }).saleId).toBeNull();
  });
  it("two \"+1\" posts → two groups; a row without sale_id keeps the old grouping", () => {
    const g = groupWaitlist([wl({ id: 1, saleId: 1 }), wl({ id: 2, commentId: "c2", saleId: 2 }), wl({ id: 3, commentId: "c3", saleId: 1 }), wl({ id: 4, commentId: "c4" }), wl({ id: 5, commentId: "c5" })]);
    expect(g.map((x) => [x.code, x.saleId, x.rows.map((r) => r.id)])).toEqual([["+1", 1, [1, 3]], ["+1", 2, [2]], ["+1", null, [4, 5]]]);
  });
  it("stock is the waiting comment's own post (the older post sold out, the newer has stock)", () => {
    const sales = [plusSale(2, "Newer bag", 5, 0), plusSale(1, "Older bag", 1, 1)];
    expect(postItemStock(sales, "+1", 1)).toBe(0);
    expect(postItemStock(sales, "+1", 2)).toBe(5);
    expect(postItemStock(sales, "+1")).toBe(5); // no sale id → the first selling one, as before
  });
  it("Orders shows each post's line with its own stock and post text", () => {
    const sales = [plusSale(2, "Newer bag", 5, 0), plusSale(1, "Older bag", 1, 1)];
    const groups = groupWaitlist([wl({ id: 1, saleId: 1 }), wl({ id: 2, commentId: "c2", saleId: 2 })]);
    const w: WaitlistUi = { state: "ready", groups, stockFor: (code, _src, sid) => postItemStock(sales, code, sid ?? null), onGive: vi.fn(), onSkip: vi.fn(), busyId: null, postLabel: (sid) => sales.find((s) => s.id === sid)!.postMessage };
    view({ waitlist: w });
    expect(screen.getAllByTestId("waitlist-post-label").map((e) => e.textContent)).toEqual(["Older bag", "Newer bag"]);
    expect((screen.getByTestId("waitlist-give-1") as HTMLButtonElement).disabled).toBe(true);  // older post: sold out
    expect((screen.getByTestId("waitlist-give-2") as HTMLButtonElement).disabled).toBe(false); // newer post: in stock
  });
});
