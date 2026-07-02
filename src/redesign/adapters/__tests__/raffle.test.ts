// Raffle pure logic — entries compute (filter/group/cap-3), weighted draw
// (deterministic via injected rand), and the deterministic wheel-landing math.
import { describe, it, expect } from "vitest";
import { computeRaffleEntries, pickWeightedWinner, spinTarget, wheelGradient, RAFFLE_COLORS, type RaffleEntry } from "../raffle";
import type { LiveOrder } from "../../../lib/orderTypes";

const T0 = 1_782_990_000_000; // enabled_at anchor (epoch ms)
const order = (over: Partial<LiveOrder>): LiveOrder => ({
  orderNum: T0 + 1000, item: "A", qty: 1, price: 100, total: 100, time: "10:00",
  handle: "lhey", name: "Lhey", bNum: 1, platform: "TikTok", status: "New", date: "2026-07-02", ...over,
});

describe("computeRaffleEntries", () => {
  it("empty orders → empty entries", () => {
    expect(computeRaffleEntries([], T0)).toEqual([]);
  });
  it("filters by orderNum >= enabledAt (INCLUSIVE boundary)", () => {
    const entries = computeRaffleEntries([
      order({ orderNum: T0 - 1, handle: "before" }),
      order({ orderNum: T0, handle: "exact" }),
      order({ orderNum: T0 + 1, handle: "after" }),
    ], T0);
    expect(entries.map((e) => e.label)).toEqual(["@exact", "@after"]);
  });
  it("groups by buyer and CAPS at 3 entries (fairness)", () => {
    const orders = [1, 2, 3, 4, 5].map((i) => order({ orderNum: T0 + i, handle: "whale", bNum: 7 }));
    orders.push(order({ orderNum: T0 + 9, handle: "small", bNum: 8 }));
    const entries = computeRaffleEntries(orders, T0);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ label: "@whale", bNum: 7, entries: 3 }); // 5 orders → capped 3
    expect(entries[1]).toMatchObject({ label: "@small", entries: 1 });
  });
  it("same handle on different platforms = different buyers", () => {
    const entries = computeRaffleEntries([
      order({ handle: "ana", platform: "TikTok" }),
      order({ handle: "ana", platform: "Facebook", bNum: 2 }),
    ], T0);
    expect(entries).toHaveLength(2);
  });
  it("no handle → falls back to name label + #bNum key", () => {
    const entries = computeRaffleEntries([order({ handle: "", name: "Walk-in", bNum: 12 })], T0);
    expect(entries[0]).toMatchObject({ label: "Walk-in", bNum: 12, key: "#12" });
  });
  it("assigns cycling colorIndex 0..7 in order of first appearance", () => {
    const entries = computeRaffleEntries(
      Array.from({ length: 10 }, (_, i) => order({ handle: `b${i}`, bNum: i, orderNum: T0 + i })), T0);
    expect(entries.map((e) => e.colorIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });
});

const pool = (weights: number[]): RaffleEntry[] =>
  weights.map((w, i) => ({ key: `k${i}`, bNum: i, label: `@b${i}`, entries: w, colorIndex: i % 8 }));

describe("pickWeightedWinner", () => {
  it("empty pool → -1", () => {
    expect(pickWeightedWinner([], 0.5)).toBe(-1);
  });
  it("respects weights deterministically (entries = chances)", () => {
    const p = pool([1, 3]); // total 4: [0,1) → idx0, [1,4) → idx1
    expect(pickWeightedWinner(p, 0.0)).toBe(0);
    expect(pickWeightedWinner(p, 0.24)).toBe(0);
    expect(pickWeightedWinner(p, 0.25)).toBe(1);
    expect(pickWeightedWinner(p, 0.99)).toBe(1);
  });
  it("rand=1 edge clamps to the last buyer (never out of range)", () => {
    expect(pickWeightedWinner(pool([1, 1]), 1)).toBe(1);
  });
});

describe("spinTarget — deterministic wheel landing", () => {
  it("always spins FORWARD at least 5 turns from prev", () => {
    const t = spinTarget(730, 0, 4, 0.5);
    expect(t).toBeGreaterThanOrEqual(720 + 5 * 360);
  });
  it("lands the chosen slice under the top pointer (within the slice bounds)", () => {
    const count = 6, idx = 2, slice = 360 / count;
    const t = spinTarget(0, idx, count, 0.5); // rand .5 = zero jitter → exact center
    const landed = ((360 - (t % 360)) % 360) / slice; // pointer angle → slice position
    expect(Math.floor(landed)).toBe(idx);
    // jittered rands still stay INSIDE slice idx
    for (const r of [0, 0.1, 0.9, 1]) {
      const tj = spinTarget(0, idx, count, r);
      const pos = ((360 - (tj % 360)) % 360) / slice;
      expect(Math.floor(pos === count ? count - 1 : pos)).toBe(idx);
    }
  });
});

describe("wheelGradient", () => {
  it("one stop per buyer using their stable color", () => {
    const g = wheelGradient(pool([1, 1, 1]));
    expect(g).toContain("conic-gradient(");
    expect(g).toContain(`${RAFFLE_COLORS[0]} 0.00deg 120.00deg`);
    expect(g).toContain(`${RAFFLE_COLORS[2]} 240.00deg 360.00deg`);
  });
});
