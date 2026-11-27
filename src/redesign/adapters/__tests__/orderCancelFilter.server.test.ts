// Cancel order (sql/234) — the server's Facebook receipt readers leave cancelled rows out; before the
// column exists the read is done once more without the filter and never again.
import { describe, it, expect, beforeEach } from "vitest";
import { readWithoutCancelled, isMissingCancelledColumn, cancelledColumnMissing, __resetCancelledColumn } from "../../../../server/orderCancelFilter.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fakeQuery(log: string[]) {
  const q = { is: (c: string, v: unknown) => { log.push(`is:${c}:${v}`); return q; } };
  return q;
}
beforeEach(() => __resetCancelledColumn());

describe("readWithoutCancelled", () => {
  it("adds .is('cancelled_at', null) while the column exists", async () => {
    const log: string[] = [];
    const r = await readWithoutCancelled(async (f) => { f(fakeQuery(log)); return { data: [1], error: null }; });
    expect(r.data).toEqual([1]);
    expect(log).toEqual(["is:cancelled_at:null"]);
  });
  it("column missing → once more without the filter, then never again", async () => {
    const log: string[] = [];
    let n = 0;
    const run = async (f: (q: ReturnType<typeof fakeQuery>) => unknown) => {
      n++; const before = log.length; f(fakeQuery(log));
      return log.length > before ? { data: null, error: { code: "42703", message: "column live_session_orders.cancelled_at does not exist" } } : { data: [2], error: null };
    };
    const r = await readWithoutCancelled(run);
    expect(r.data).toEqual([2]);
    expect(n).toBe(2);
    expect(cancelledColumnMissing()).toBe(true);
    await readWithoutCancelled(run);
    expect(n).toBe(3);
    expect(log).toEqual(["is:cancelled_at:null"]);
  });
  it("another error is returned as it is", async () => {
    let n = 0;
    const r = await readWithoutCancelled(async (f) => { n++; f(fakeQuery([])); return { data: null, error: { message: "boom" } }; });
    expect(r.error).toEqual({ message: "boom" });
    expect(n).toBe(1);
  });
  it("isMissingCancelledColumn", () => {
    expect(isMissingCancelledColumn({ code: "42703", message: "column cancelled_at does not exist" })).toBe(true);
    expect(isMissingCancelledColumn({ code: "42703", message: "column x does not exist" })).toBe(false);
  });
  it("server.js: both Facebook receipt row readers go through it (Send all + after-live)", () => {
    const src = readFileSync(resolve(process.cwd(), "server.js"), "utf8");
    const a = src.slice(src.indexOf("async listSessionFbRows"), src.indexOf("async listSessionReceipts"));
    const b = src.slice(src.indexOf("async listLiveRows"), src.indexOf("async listPages"));
    expect(a).toContain("readWithoutCancelled");
    expect(b).toContain("readWithoutCancelled");
  });
});
