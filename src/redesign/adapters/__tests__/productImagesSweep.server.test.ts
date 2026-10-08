// A3 — product-picture cleanup sweep (server/productImagesSweep.js + the server.js route).
// Pins: only unreferenced files older than 24 h go; a fresh unreferenced file stays; a file
// with no timestamp stays; an unreadable referenced set / bucket list deletes nothing; the
// delete cap; counts-only logging; the off switch reads only the exact 'true'; the route
// checks the token before anything, answers 204 when off, 202 + background run when on,
// never touches the Facebook block; sql/98 seeds the switch off.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { orphanPaths, sweepProductImages, lastWriteMs, readSweepSwitch, makeSweepStore, SWEEP_GRACE_MS } from "../../../../server/productImagesSweep.js";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const file = (name: string, hoursAgo: number | null, extra: Record<string, unknown> = {}) =>
  ({ id: `id-${name}`, name, created_at: hoursAgo == null ? null : ago(hoursAgo), updated_at: null, ...extra });

const fakeStore = (o: { folders?: string[] | null; files?: Record<string, unknown[] | null>; refs?: Set<string> | null; removeOk?: boolean } = {}) => {
  const removed: string[][] = [];
  return {
    removed,
    referencedPaths: vi.fn(async () => (o.refs === undefined ? new Set<string>() : o.refs)),
    listFolders: vi.fn(async () => (o.folders === undefined ? ["u1"] : o.folders)),
    listFiles: vi.fn(async (f: string) => (o.files && f in o.files ? o.files[f] : [])),
    remove: vi.fn(async (p: string[]) => { removed.push(p); return o.removeOk ?? true; }),
  };
};

describe("orphanPaths (pure)", () => {
  it("unreferenced and older than 24 h → delete; referenced or fresh → keep", () => {
    const files = [file("1.jpg", 30), file("2.jpg", 30), file("3.jpg", 2), file("4.jpg", 24.5)];
    expect(orphanPaths("u1", files, new Set(["u1/2.jpg"]), NOW)).toEqual(["u1/1.jpg", "u1/4.jpg"]);
  });
  it("exactly 24 h old stays (strictly older only)", () => {
    expect(orphanPaths("u1", [file("1.jpg", 24)], new Set(), NOW)).toEqual([]);
  });
  it("no timestamp, sub-folders and placeholders stay", () => {
    expect(orphanPaths("u1", [file("1.jpg", null), { name: "sub", id: null }, { id: "x" }], new Set(), NOW)).toEqual([]);
  });
  it("a recent replace (updated_at) counts as a fresh write", () => {
    expect(orphanPaths("u1", [file("1.jpg", 72, { updated_at: ago(1) })], new Set(), NOW)).toEqual([]);
    expect(lastWriteMs(file("1.jpg", 72, { updated_at: ago(1) }))).toBe(NOW - 3600_000);
  });
  it("matches the exact path only (another seller's folder never counts)", () => {
    expect(orphanPaths("u2", [file("7.jpg", 30)], new Set(["u1/7.jpg"]), NOW)).toEqual(["u2/7.jpg"]);
  });
  it("the grace is 24 h", () => expect(SWEEP_GRACE_MS).toBe(86_400_000));
});

describe("sweepProductImages", () => {
  it("deletes per folder, logs counts only (no names)", async () => {
    const s = fakeStore({ folders: ["u1", "u2"], files: { u1: [file("1.jpg", 30), file("2.jpg", 30)], u2: [file("9.jpg", 1)] }, refs: new Set(["u1/2.jpg"]) });
    const logs: string[] = [];
    const r = await sweepProductImages({ store: s, now: () => NOW, log: (m: string) => { logs.push(m); } });
    expect(s.removed).toEqual([["u1/1.jpg"]]);
    expect(r).toMatchObject({ ok: true, folders: 2, files: 3, orphans: 1, deleted: 1 });
    expect(logs.join("\n")).not.toMatch(/u1|u2|\.jpg/);
    expect(logs.at(-1)).toMatch(/folders=2 files=3 orphans=1 deleted=1/);
  });
  it("referenced paths unreadable → nothing deleted", async () => {
    const s = fakeStore({ refs: null, files: { u1: [file("1.jpg", 99)] } });
    expect((await sweepProductImages({ store: s, now: () => NOW })).ok).toBe(false);
    expect(s.remove).not.toHaveBeenCalled();
    const t = fakeStore({ files: { u1: [file("1.jpg", 99)] } });
    t.referencedPaths.mockRejectedValueOnce(new Error("db down"));
    await sweepProductImages({ store: t, now: () => NOW });
    expect(t.remove).not.toHaveBeenCalled();
  });
  it("bucket list unreadable → nothing deleted; one folder failing skips only it", async () => {
    const a = fakeStore({ folders: null });
    expect((await sweepProductImages({ store: a, now: () => NOW })).ok).toBe(false);
    const b = fakeStore({ folders: ["u1", "u2"], files: { u1: null, u2: [file("1.jpg", 30)] } });
    const r = await sweepProductImages({ store: b, now: () => NOW });
    expect(b.removed).toEqual([["u2/1.jpg"]]);
    expect(r.failedFolders).toBe(1);
  });
  it("caps deletes per run", async () => {
    const s = fakeStore({ files: { u1: [file("1.jpg", 30), file("2.jpg", 30), file("3.jpg", 30)] } });
    const r = await sweepProductImages({ store: s, now: () => NOW, maxDeletes: 2 });
    expect(r.deleted).toBe(2);
    expect(s.removed.flat()).toHaveLength(2);
  });
});

describe("store + switch", () => {
  it("the switch is on only for the exact 'true'", async () => {
    const sb = (value: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }) });
    expect(await readSweepSwitch(sb("true"))).toBe(true);
    for (const v of ["false", "TRUE", "1", undefined]) expect(await readSweepSwitch(sb(v))).toBe(false);
    expect(await readSweepSwitch(sb("true", { message: "x" }))).toBe(false);
  });
  it("the store lists folders (no id) and pages files; referenced paths read every page", async () => {
    const lists: string[] = [];
    const bucket = { list: vi.fn(async (prefix: string, o: { offset: number }) => { lists.push(`${prefix}@${o.offset}`); return prefix === "" ? { data: o.offset === 0 ? [{ name: "u1", id: null }, { name: "stray.jpg", id: "z" }] : [], error: null } : { data: o.offset === 0 ? [file("1.jpg", 30), file("2.jpg", 30)] : [], error: null }; }), remove: vi.fn(async () => ({ error: null })) };
    const pages = [[{ image_path: "u1/1.jpg" }, { image_path: "u1/3.jpg" }], [{ image_path: "u9/9.jpg" }]];
    const q: Record<string, unknown> = {};
    let page = 0;
    for (const m of ["select", "not", "order"]) q[m] = () => q;
    q.range = async () => ({ data: pages[page++] ?? [], error: null });
    const st = makeSweepStore({ storage: { from: () => bucket }, from: () => q }, { pageSize: 2 });
    expect(await st.listFolders()).toEqual(["u1"]);
    expect(await st.listFiles("u1")).toHaveLength(2);
    expect([...(await st.referencedPaths())!]).toEqual(["u1/1.jpg", "u1/3.jpg", "u9/9.jpg"]);
  });
});

describe("route + sql/98 contract", () => {
  const src = readFileSync("server.js", "utf8");
  const route = src.slice(src.indexOf('app.post("/admin/product-images-sweep"'), src.indexOf("function emitTikTokStatus"));
  it("token first (header, timing-safe, lockout), then service role, then switch → 204, then single-flight 202", () => {
    const at = (s: string) => { const i = route.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const tok = at('timingSafeTokenEqual(req.headers["x-poll-token"], PRODUCT_IMAGES_SWEEP_TOKEN)');
    expect(at("productImagesSweepAuthThrottle.blocked()")).toBeLessThan(tok);
    expect(at("!serviceSb")).toBeGreaterThan(tok);
    const sw = at("readSweepSwitch(serviceSb)");
    expect(sw).toBeGreaterThan(tok);
    expect(at("res.status(204).end()")).toBeGreaterThan(sw);
    expect(at("productImagesSweepRunning")).toBeGreaterThan(sw);
    expect(at("res.status(202)")).toBeLessThan(at("sweepProductImages("));
    expect(route).not.toMatch(/req\.query/);
  });
  it("the body parser is skipped for the route; not inside the Facebook block", () => {
    expect(src).toContain('req.path === "/admin/product-images-sweep"');
    const fbBlock = src.indexOf("if (fbCfg.enabled && serviceSb && RENDER_URL)");
    expect(src.indexOf('app.post("/admin/product-images-sweep"')).toBeLessThan(fbBlock);
  });
  it("cron entry documented; sql/98 seeds the switch off", () => {
    const mod = readFileSync("server/productImagesSweep.js", "utf8");
    expect(mod).toContain("POST https://sellerflow-live-server.onrender.com/admin/product-images-sweep");
    expect(mod).toMatch(/daily/);
    const sql = readFileSync("sql/98_product_images_sweep_switch.sql", "utf8");
    expect(sql).toContain("('product_images_sweep_enabled', 'false')");
    expect(sql).toContain("on conflict (key) do nothing");
    for (const f of ["sql/98_product_images_sweep_switch.sql", "sql/98_product_images_sweep_switch_rollback.sql"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
      expect(s).not.toContain("\\u");
    }
  });
});
