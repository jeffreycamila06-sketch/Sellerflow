// BUYER TAG — OLD / NEW pill. Pins: the key rule (TikTok by handle, Facebook by display name,
// case / space / one "@" normalised, platform-scoped), not loaded → null → no pill, the RPC
// parse, the Dashboard + Orders rows (OLD / NEW / none, placement right after the handle, or
// after the name for Facebook), one RPC per live start + refresh (never per comment), a failed
// refresh keeps the last map, the wiring, and the sql/102 contract.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TProvider, buildT } from "../../i18n";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc, auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import { buyerTagFor, buyerTagKey, parseBuyerTags, useBuyerTags, BUYER_TAG_REFRESH_MS } from "../../adapters/buyerTag";
import Dashboard from "../Dashboard";
import Orders from "../Orders";
import type { Comment, Order } from "../../data";

const MAP = parseBuyerTags({ tiktok: ["anna_shop", "bo"], facebook: ["maria santos"] });

describe("buyerTagFor", () => {
  it("TikTok by handle: @, case and spaces normalised", () => {
    expect(buyerTagFor(MAP, "@Anna_Shop ", "whatever", "TikTok")).toBe("old");
    expect(buyerTagFor(MAP, "anna_shop", "", "tiktok")).toBe("old");
    expect(buyerTagFor(MAP, "@carl", "Anna_Shop", "TikTok")).toBe("new");
  });
  it("Facebook by display name (never the handle)", () => {
    expect(buyerTagFor(MAP, "12345", "  Maria SANTOS ", "Facebook")).toBe("old");
    expect(buyerTagFor(MAP, "maria santos", "Someone Else", "Facebook")).toBe("new");
  });
  it("platform-scoped: a TikTok buyer is not OLD on Facebook and back", () => {
    expect(buyerTagFor(MAP, "bo", "bo", "Facebook")).toBe("new");
    expect(buyerTagFor(MAP, "@maria santos", "maria santos", "TikTok")).toBe("new");
  });
  it("not loaded → null; no key → null", () => {
    expect(buyerTagFor(null, "@anna_shop", "x", "TikTok")).toBeNull();
    expect(buyerTagFor(undefined, "@anna_shop", "x", "TikTok")).toBeNull();
    expect(buyerTagFor(MAP, "", "", "TikTok")).toBeNull();
    expect(buyerTagFor(MAP, "@a", "a", "")).toBeNull();
    expect(buyerTagKey("@", "Name", "TikTok")).toBe("tiktok|name"); // empty handle → name
  });
  it("parse drops anything malformed", () => {
    expect([...parseBuyerTags({ TikTok: [" A ", 3, "", null], "": ["x"], fb: "nope" })]).toEqual(["tiktok|a"]);
    for (const bad of [null, [], "x", 5]) expect(parseBuyerTags(bad).size).toBe(0);
  });
});

const noop = () => {};
const comment = (name: string, handle: string, platform = "TikTok"): Comment =>
  ({ id: `c-${handle || name}`, name, handle, text: "mine", mine: true, time: "9:41:00 PM", platform });
const dashProps = (comments: Comment[]) => ({
  comments, cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});
const FEED = [comment("Anna", "@anna_shop"), comment("Carl", "@carl"), comment("Maria Santos", "", "Facebook")];

describe("Dashboard rows", () => {
  it("OLD / NEW pills; TikTok right after the @handle, Facebook right after the name", () => {
    const { container } = render(<TProvider lang="en"><Dashboard {...dashProps(FEED)} buyerTags={MAP} /></TProvider>);
    const rows = [...container.querySelectorAll(".sfl-comm-row")];
    const pill = (r: Element) => r.querySelector('[data-testid="buyer-tag"]');
    expect(rows.map((r) => pill(r)?.getAttribute("data-tag"))).toEqual(["old", "new", "old"]);
    expect(pill(rows[0])!.textContent).toBe("OLD");
    expect(pill(rows[1])!.textContent).toBe("NEW");
    expect(pill(rows[0])!.previousElementSibling!.textContent).toBe("@anna_shop");
    expect(pill(rows[2])!.previousElementSibling!.textContent).toBe("Maria Santos");
  });
  it("map null / absent → no pill and the same markup", () => {
    const a = render(<TProvider lang="en"><Dashboard {...dashProps(FEED)} /></TProvider>);
    const b = render(<TProvider lang="en"><Dashboard {...dashProps(FEED)} buyerTags={null} /></TProvider>);
    expect(a.container.querySelector('[data-testid="buyer-tag"]')).toBeNull();
    expect(b.container.innerHTML).toBe(a.container.innerHTML);
  });
  it("label follows the app language", () => {
    const { container } = render(<TProvider lang="fil"><Dashboard {...dashProps(FEED)} buyerTags={MAP} /></TProvider>);
    expect([...container.querySelectorAll('[data-testid="buyer-tag"]')].map((e) => e.textContent)).toEqual(["SUKI", "BAGO", "SUKI"]);
  });
});

describe("Orders rows", () => {
  const o = (id: number, buyer: string, handle: string, platform: string): Order =>
    ({ id: `#${id}`, buyer, handle, items: "Dress", qty: 1, total: 100, status: "New", platform, time: "1:00 PM", orderNum: id, date: "2026-10-09" });
  const ORD = [o(1, "Anna", "@anna_shop", "TikTok"), o(2, "Carl", "@carl", "TikTok"), o(3, "Maria Santos", "@Maria Santos", "Facebook")];
  const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Orders onGoPrint={noop} cur="NT$" orders={ORD} state="live" todayId="2026-10-09" buyers={[]} {...extra} /></TProvider>);
  it("same pill from the same map", () => {
    const { container } = view({ buyerTags: MAP });
    expect([...container.querySelectorAll('[data-testid="buyer-tag"]')].map((e) => e.getAttribute("data-tag"))).toEqual(["old", "new", "old"]);
  });
  it("map null → no pill, same markup", () => {
    const a = view(); const b = view({ buyerTags: null });
    expect(a.container.querySelector('[data-testid="buyer-tag"]')).toBeNull();
    expect(b.container.innerHTML).toBe(a.container.innerHTML);
  });
});

describe("useBuyerTags", () => {
  beforeEach(() => { vi.useFakeTimers(); rpc.mockReset(); });
  afterEach(() => vi.useRealTimers());
  it("no live → no RPC; live → one RPC, then one per 10 min; a failed refresh keeps the map", async () => {
    rpc.mockResolvedValue({ data: { tiktok: ["anna_shop"] }, error: null });
    const { result, rerender } = renderHook(({ live }) => useBuyerTags(live), { initialProps: { live: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(BUYER_TAG_REFRESH_MS * 2); });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ live: true });
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("buyer_tag_lookup");
    expect(result.current?.has("tiktok|anna_shop")).toBe(true);
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(BUYER_TAG_REFRESH_MS); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.current?.has("tiktok|anna_shop")).toBe(true);
  });
});

describe("i18n + wiring + sql/102", () => {
  it("labels in all 8 languages, short", () => {
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(l);
      for (const v of [t.rd_bt_old, t.rd_bt_new]) { expect(String(v).trim()).not.toBe(""); expect(String(v).length).toBeLessThanOrEqual(10); }
    }
  });
  it("RedesignApp: one hook on the same live trigger as Buyer Alert; map passed to Dashboard + Orders", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const buyerTags = useBuyerTags(ttEff || fbEff || shopeeEff || igEff, featureSw.fbIdentityV2);");
    expect(src.match(/buyerTags=\{buyerTags\}/g)).toHaveLength(2);
    expect(src.match(/useBuyerTags\(/g)).toHaveLength(1);
  });
  it("sql/102: own rows only, cap 20000, invoker, authenticated only; rollback plain drop", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../sql", "102_buyer_tag.sql"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sql).toContain("where c.user_id = (select auth.uid())");
    expect(sql).toContain("limit 20000");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("revoke all on function public.buyer_tag_lookup() from anon;");
    expect(sql).toContain("grant execute on function public.buyer_tag_lookup() to authenticated;");
    expect(sql).not.toMatch(/drop /i);
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "102_buyer_tag_rollback.sql"), "utf8");
    expect(rb).not.toMatch(/if exists/i);
  });
});
