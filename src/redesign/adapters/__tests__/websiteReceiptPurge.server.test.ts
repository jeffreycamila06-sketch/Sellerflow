// @vitest-environment node
// Seller Website audit 4 — the daily receipt-picture cleanup (server/websiteReceiptPurge.js): pages
// through the database's list and deletes through the Storage API, stops at the cap / on a partial
// delete / on an error (never throws), logs counts only, runs 15 min after start then daily, and is
// wired in server.js as its OWN job (only with the service role) without touching the others.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  purgeWebsiteReceipts, startWebsiteReceiptPurge, makeWebsiteReceiptStore,
  WEBSITE_RECEIPT_PURGE_FIRST_MS, WEBSITE_RECEIPT_PURGE_EVERY_MS, WEBSITE_RECEIPT_PURGE_MAX,
} from "../../../../server/websiteReceiptPurge.js";

const tok = (c: string) => c.repeat(64);
const paths = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `${tok("a")}/r${1700000000000 + from + i}.jpg`);

describe("purgeWebsiteReceipts", () => {
  it("deletes page by page until the list is empty; logs only the count", async () => {
    let left = paths(230);
    const store = { listPurgeable: vi.fn(async (n: number) => left.slice(0, n)), remove: vi.fn(async (p: string[]) => { left = left.filter((x) => !p.includes(x)); return p.length; }) };
    const log = vi.fn();
    expect(await purgeWebsiteReceipts({ store, log })).toBe(230);
    expect(store.remove).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith("[WEBSITE] receipt purge deleted=230");
    expect(JSON.stringify(log.mock.calls)).not.toContain(tok("a"));
  });
  it("stops at the per-run cap, on a partial delete, and on an error (never throws)", async () => {
    const big = { listPurgeable: vi.fn(async (n: number) => paths(n)), remove: vi.fn(async (p: string[]) => p.length) };
    expect(await purgeWebsiteReceipts({ store: big })).toBe(WEBSITE_RECEIPT_PURGE_MAX);
    const partial = { listPurgeable: vi.fn(async (n: number) => paths(n)), remove: vi.fn(async () => 3) };
    expect(await purgeWebsiteReceipts({ store: partial })).toBe(3);
    expect(partial.listPurgeable).toHaveBeenCalledTimes(1);
    const log = vi.fn();
    const broken = { listPurgeable: vi.fn(async () => { throw new Error("list_failed"); }), remove: vi.fn() };
    await expect(purgeWebsiteReceipts({ store: broken, log })).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith("[WEBSITE] receipt purge deleted=0 (stopped on an error)");
    expect(broken.remove).not.toHaveBeenCalled();
  });
  it("only folder/file names are ever passed to remove (junk from the list is dropped)", async () => {
    const store = { listPurgeable: vi.fn(async () => ["", "nofolder.jpg", `${tok("b")}/r1.jpg`]), remove: vi.fn(async (p: string[]) => p.length) };
    await purgeWebsiteReceipts({ store });
    expect(store.remove).toHaveBeenCalledWith([`${tok("b")}/r1.jpg`]);
  });
});

describe("startWebsiteReceiptPurge", () => {
  it("first run 15 min after start, then every 24 h; stop() clears both", () => {
    const setOnce = vi.fn((_fn: () => void, _ms: number) => ({ unref: vi.fn() }) as unknown as NodeJS.Timeout);
    const setTimer = vi.fn((_fn: () => void, _ms: number) => ({ unref: vi.fn() }) as unknown as NodeJS.Timeout);
    const clearOnce = vi.fn(), clearTimer = vi.fn();
    const stop = startWebsiteReceiptPurge({ store: { listPurgeable: async () => [], remove: async () => 0 }, setOnce, setTimer, clearOnce, clearTimer });
    expect(setOnce.mock.calls[0][1]).toBe(WEBSITE_RECEIPT_PURGE_FIRST_MS);
    expect(setTimer.mock.calls[0][1]).toBe(WEBSITE_RECEIPT_PURGE_EVERY_MS);
    expect(WEBSITE_RECEIPT_PURGE_EVERY_MS).toBe(86_400_000);
    stop();
    expect(clearOnce).toHaveBeenCalled(); expect(clearTimer).toHaveBeenCalled();
  });
  it("the store lists through the service-role RPC and deletes through Storage (bucket website-receipts)", async () => {
    const remove = vi.fn(async () => ({ data: [{}, {}], error: null }));
    const from = vi.fn(() => ({ remove }));
    const rpc = vi.fn(async () => ({ data: [{ website_receipts_to_purge: "x/1" }, "y/2"], error: null }));
    const store = makeWebsiteReceiptStore({ rpc, storage: { from } });
    expect(await store.listPurgeable(50)).toEqual(["x/1", "y/2"]);
    expect(rpc).toHaveBeenCalledWith("website_receipts_to_purge", { p_limit: 50 });
    expect(await store.remove(["x/1", "y/2"])).toBe(2);
    expect(from).toHaveBeenCalledWith("website-receipts");
  });
});

describe("server.js wiring", () => {
  const src = readFileSync("server.js", "utf8");
  it("its own job, started only with the service role; the existing cleanups are unchanged", () => {
    expect(src).toContain('import { startWebsiteReceiptPurge, makeWebsiteReceiptStore } from "./server/websiteReceiptPurge.js";');
    expect(src).toMatch(/if \(serviceSb\) \{\n  try \{ startWebsiteReceiptPurge\(\{ store: makeWebsiteReceiptStore\(serviceSb\), log: \(line\) => console\.log\(line\) \}\); \}/);
    expect(src).toContain("stopReceiptCleanup = startReceiptImageCleanup({ store, log: (line) => console.log(line) });");
    expect(src.match(/startWebsiteReceiptPurge\(/g)).toHaveLength(1);
  });
});
