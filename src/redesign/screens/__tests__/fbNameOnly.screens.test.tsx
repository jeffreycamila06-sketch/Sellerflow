// FACEBOOK NAME ONLY — screens. A Facebook buyer's handle IS the display name, so every
// screen shows the name ONCE (no "@name" under/beside it). Decided by PLATFORM only: a TikTok
// buyer keeps both lines even when the nickname equals the username. Guard: a Facebook comment
// with no name (server "Unknown", handle = the id) keeps today's handle line.
// Sales tab: unchanged by decision (no platform in its data).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import Orders from "../Orders";
import Customers from "../Customers";
import CustomerData from "../CustomerData";
import Miners from "../Miners";
import PeakHourDrill from "../../components/PeakHourDrill";
import { entryDisplay } from "../../adapters/raffle";
import type { Comment, Order, Customer } from "../../data";
import type { Buyer } from "../../../lib/orderTypes";
import type { UseMinersReport } from "../../adapters/minersReport";
import type { UsePeakHourOrders } from "../../adapters/peakHours";

const FB = "Caren Kay Ragasa Chao";
const wrap = (ui: React.ReactNode) => render(<TProvider lang="en">{ui}</TProvider>);
const count = (c: HTMLElement, s: string) => c.textContent!.split(s).length - 1;

describe("Live feed (Dashboard)", () => {
  const noop = () => {};
  const cm = (name: string, handle: string, platform: string): Comment =>
    ({ id: `c-${handle}-${platform}`, name, handle, text: "mine", mine: true, time: "9:41:00 PM", platform });
  const feed = (comments: Comment[]) => wrap(<Dashboard {...{
    comments, cur: "NT$", historyReady: true, ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
    onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
    ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
    onConnectTT: noop, onConnectFB: noop, printed: {}, entId: null, entPrice: "",
    onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
  }} />);
  it("Facebook row: the name once, no @name", () => {
    const { container } = feed([cm(FB, `@${FB}`, "Facebook")]);
    expect(count(container, FB)).toBe(1);
    expect(container.textContent).not.toContain(`@${FB}`);
  });
  it("TikTok row: name + @handle (unchanged), even when the nickname equals the username", () => {
    const { container } = feed([cm("Joy M", "@kaldag_queen_oo", "TikTok"), cm("joym", "@joym", "TikTok")]);
    expect(container.textContent).toContain("@kaldag_queen_oo");
    expect(container.textContent).toContain("@joym");
  });
  it("guard: Facebook comment with no name (\"Unknown\", handle = id) keeps the handle line", () => {
    const { container } = feed([cm("Unknown", "@1029384756473829", "Facebook")]);
    expect(container.textContent).toContain("@1029384756473829");
  });
});

describe("Orders tab — list row + buyer box", () => {
  const o = (over: Partial<Order>): Order => ({ id: "#7", buyer: FB, handle: `@${FB}`, items: "A01", qty: 1, total: 320, status: "New", platform: "Facebook", time: "9:41 PM", orderNum: 1, date: "2026-10-06", ...over });
  const b = (platform: string, name: string, handle: string): Buyer => ({ num: 7, name, handle, platform, orders: [{ orderNum: 1, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle, name, bNum: 7, platform, status: "New", date: "2026-10-06" }], totalOrders: 1, totalSpent: 320 } as unknown as Buyer);
  const renderO = (orders: Order[], buyers: Buyer[] = []) =>
    wrap(<Orders onGoPrint={vi.fn()} cur="NT$" orders={orders} state="live" todayId="2026-10-06" buyers={buyers} />);
  it("Facebook row: name once; TikTok row: name + @handle", () => {
    const { container } = renderO([o({}), o({ id: "#8", buyer: "Joy M", handle: "@kaldag_queen_oo", platform: "TikTok" })]);
    expect(container.textContent).not.toContain(`@${FB}`);
    expect(container.textContent).toContain(FB);
    expect(container.textContent).toContain("@kaldag_queen_oo");
  });
  it("buyer box (numeric search): Facebook shows the name once; TikTok keeps the handle", () => {
    const fb = renderO([o({})], [b("Facebook", FB, FB)]);
    fireEvent.change(fb.container.querySelector("input")!, { target: { value: "7" } });
    const box = fb.getByTestId("buyer-receipt");
    expect(count(box, FB)).toBe(1);
    fb.unmount();
    const tt = renderO([o({ platform: "TikTok", buyer: "Joy M", handle: "@kaldag_queen_oo" })], [b("TikTok", "Joy M", "@kaldag_queen_oo")]);
    fireEvent.change(tt.container.querySelector("input")!, { target: { value: "7" } });
    expect(tt.getByTestId("buyer-receipt").textContent).toContain("@kaldag_queen_oo");
  });
});

describe("Customers + Customer data", () => {
  const cust = (name: string, handle: string, platform: string): Customer => ({ name, handle, orders: 2, spent: 640, last: "2m", platform });
  it("Customers: Facebook shows the platform only; TikTok keeps '@handle · TikTok'", () => {
    const { container } = wrap(<Customers cur="NT$" customers={[cust(FB, `@${FB}`, "Facebook"), cust("Joy M", "@kaldag_queen_oo", "TikTok")]} state="live" />);
    expect(container.textContent).not.toContain(`@${FB}`);
    expect(container.textContent).toContain("@kaldag_queen_oo · TikTok");
  });
  it("Customer data: Facebook name once; TikTok keeps the handle; 'Unknown' keeps its id", () => {
    const { container } = wrap(<CustomerData onLegal={vi.fn()} cur="NT$" customers={[cust(FB, `@${FB}`, "Facebook"), cust("Joy M", "@kaldag_queen_oo", "TikTok"), cust("Unknown", "@1029384756473829", "Facebook")]} />);
    expect(container.textContent).not.toContain(`@${FB}`);
    expect(container.textContent).toContain("@kaldag_queen_oo");
    expect(container.textContent).toContain("@1029384756473829");
  });
});

describe("Miners + peak-hour list + raffle winner", () => {
  it("Miners: Facebook name once; TikTok keeps @handle", () => {
    const rep: UseMinersReport = { state: "live", load: vi.fn(), reload: vi.fn(), data: {
      spent: 1000, orders: 3, buyers: 2, avg: 333, tiktokPct: 50, fbPct: 50, start: "2026-10-01", end: "2026-10-06", limit: 10,
      top: [
        { name: FB, handle: `@${FB}`, platform: "Facebook", spent: 640, orders: 2, activeDays: 1, repeat: false },
        { name: "Joy M", handle: "@kaldag_queen_oo", platform: "TikTok", spent: 360, orders: 1, activeDays: 1, repeat: false },
      ] } };
    const { container } = wrap(<Miners cur="NT$" rep={rep} todayId="2026-10-06" sessionStartId="2026-10-01" />);
    expect(container.textContent).not.toContain(`@${FB}`);
    expect(container.textContent).toContain("@kaldag_queen_oo");
  });
  it("Peak-hour list: Facebook name once; TikTok keeps @handle", () => {
    const drill: UsePeakHourOrders = { state: "live", open: true, openCell: vi.fn(), close: vi.fn(), data: { dow: 1, hour: 21, date: "2026-10-06", rows: [
      { buyerNumber: 7, name: FB, handle: `@${FB}`, platform: "Facebook", product: "A01", price: 320, createdAt: "2026-10-06T13:05:00Z" },
      { buyerNumber: 8, name: "Joy M", handle: "@kaldag_queen_oo", platform: "TikTok", product: "A02", price: 360, createdAt: "2026-10-06T13:06:00Z" },
    ] } };
    wrap(<PeakHourDrill cur="NT$" drill={drill} />); // renders in a portal on document.body
    expect(document.body.textContent).toContain(FB);
    expect(document.body.textContent).not.toContain(`@${FB}`);
    expect(document.body.textContent).toContain("@kaldag_queen_oo");
  });
  it("Raffle winner: Facebook 'Name' only; TikTok 'Name (@handle)'; 'Unknown' unchanged", () => {
    const e = (key: string, label: string, displayName: string) => ({ key, bNum: 7, label, displayName, entries: 1, colorIndex: 0 });
    expect(entryDisplay(e(`${FB.toLowerCase()}|Facebook`, `@${FB}`, FB))).toBe(FB);
    expect(entryDisplay(e("kaldag_queen_oo|TikTok", "@kaldag_queen_oo", "Joy M"))).toBe("Joy M (@kaldag_queen_oo)");
    expect(entryDisplay(e("1029384756473829|Facebook", "@1029384756473829", "Unknown"))).toBe("Unknown (@1029384756473829)");
  });
});
