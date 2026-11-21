// @vitest-environment node
// Shopee Live — other viewers' comments (content type 100, production [SHOPEE-DIAG] 2026-11-21: a second account's two
// comments arrived as type 100 and were dropped as "no text"; the host's own are type 101).
//   V1  commentTextOf: type 100 with a sender uid and a real text → the text; without either → not a comment;
//       every message that is NOT type 100 gives exactly main's answer
//   V2  through the REAL reader: a type-100 comment is emitted with the very payload a type-101 comment with the same
//       fields gets; type 100 without text / uid is dropped
//   V3  a generated corpus (2,047 messages, 10 runs): the branch reader on the corpus = main's reader on the corpus with
//       every guard-passing type-100 message rewritten to 101 — same comments, statuses, requests, answers, logs
//   V4  the diagnostic: kept_100, keys_100 (field paths, names only), and the old counters exactly main's
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { commentTextOf, shopeeToPayload, createShopeeLinkRuntime as createBranch, SHOPEE_VIEWER_TEXT_TYPE, SHOPEE_HOST_TEXT_TYPE } from "../../../../server/shopeeLiveLink.js";
import { createShopeeDiag, contentPaths, messageShape, DIAG_100_SHAPES_MAX, DIAG_SHAPE_LINES_MAX, DIAG_EVERY_MS, DIAG_PATHS_MAX } from "../../../../server/shopeeDiag.js";
import { commentTextOf as mainCommentTextOf, createShopeeLinkRuntime as createMain } from "./fixtures/shopeeLiveLink.main.js";
import { createShopeeDiag as createMainDiag } from "./fixtures/shopeeDiag.main.js";

const HOST_UID = 254298659, VIEWER_UID = 98765432;
const TW_LINK = `https://live.shopee.tw/share?from=live&session=8092367&share_user_id=${HOST_UID}`;
const hostBody = (over: Record<string, unknown> = {}) => ({ err_code: 0, data: { session: { session_id: 8092367, uid: HOST_UID, status: 1, chatroom_id: "SPIM-ROOM", title: "sale", ...over } } });
type M = Record<string, unknown>;
const json = (o: M) => JSON.stringify(o);
const host101 = (id: number, text: string, o: M = {}): M => ({ id, uid: HOST_UID, nickname: "HostNick", display_name: "HostNick", avatar: "https://cf.shopee.tw/file/a", content: json({ type: 101, content: text, content_v2: "" }), ts: 1793033483, privacy_type: 0, ...o });
const viewer100 = (id: number, text: string, o: M = {}): M => ({ id, uid: VIEWER_UID, nickname: "Viewer A", display_name: "Viewer A", username: "viewer_a", avatar: "https://cf.shopee.tw/file/v", content: json({ type: 100, content: text, content_v2: "" }), ts: 1793033490, privacy_type: 0, ...o });
const body = (d: M) => ({ code: 0, msg: "success", data: { timestamp: 1793033485, poll_interval: 3, ...d } });
const batch = (msgs: M[]) => [{ msgs, timestamp: 1793033485 }];
const mkRes = (status: number, b: unknown) => ({ status, json: async () => b, headers: { get: () => null } });

function rig(make: typeof createBranch = createBranch) {
  const logs: string[] = [], emitted: unknown[][] = [], statuses: unknown[][] = [], urls: string[] = [];
  let t = 1_000_000;
  let chat: () => unknown = () => mkRes(200, body({}));
  let host: () => unknown = () => mkRes(200, hostBody());
  const fetchImpl = vi.fn(async (u: string) => { urls.push(u); return u.includes("host_session") ? host() : u.includes("/message?") ? chat() : mkRes(404, null); });
  const rt = make({
    emitComment: (...a: unknown[]) => emitted.push(a), statusEmit: (...a: unknown[]) => statuses.push(JSON.parse(JSON.stringify(a))), rememberAccount: async () => {},
    fetchImpl, now: () => t, log: (l: string) => logs.push(l), liveKey: (s: string, p: string, k: string) => `${s}:${p}:${k}`,
    enabled: async () => true, betaAllowed: async () => true, setLoop: () => 1, clearLoop: () => {},
  });
  return {
    rt, logs, emitted, statuses, urls, diagLines: () => logs.filter((l) => l.startsWith("[SHOPEE-DIAG]")),
    tick: (ms: number) => { t += ms; }, chat: (f: () => unknown) => { chat = f; }, host: (f: () => unknown) => { host = f; },
    connect: () => rt.connect({ sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc", shareLink: TW_LINK }),
    entry: () => [...rt._pollers.values()][0],
  };
}
const field = (line: string, k: string) => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(line) || [])[1];
const isType100 = (x: M) => messageShape(x, "").type === "100";
const comments = (h: ReturnType<typeof rig>) => h.emitted.map((e) => (e[2] as { comment: string }).comment);

let spy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => { spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000"); });
afterEach(() => { spy?.mockRestore(); });

describe("V1 commentTextOf", () => {
  it("type 100 with a sender uid and a real text → the text (read like 101: `content`, else `text`)", () => {
    expect(SHOPEE_VIEWER_TEXT_TYPE).toBe(100);
    expect(SHOPEE_HOST_TEXT_TYPE).toBe(101);
    expect(commentTextOf(viewer100(1, "我要 2"))).toBe("我要 2");
    expect(commentTextOf(viewer100(1, " +1 "))).toBe(" +1 ");                                     // the text as sent, like 101
    expect(commentTextOf(viewer100(1, "", { content: json({ type: 100, text: "mine 3" }) }))).toBe("mine 3");
    expect(commentTextOf(viewer100(1, "", { content: json({ type: "100", content: "D" }) }))).toBe("D");
    expect(commentTextOf(viewer100(1, "", { content: { type: 100, content: "obj" } }))).toBe("obj"); // content as an object
    expect(commentTextOf(viewer100(1, "x", { uid: 0 }))).toBe("x");                                 // 0 is a uid
    expect(commentTextOf(viewer100(1, "x", { uid: "12345" }))).toBe("x");
  });
  it("type 100 without a sender uid, or without a real text → not a comment", () => {
    for (const o of [{ uid: undefined }, { uid: null }, { uid: "" }, { uid: "   " }]) expect(commentTextOf(viewer100(1, "mine", o))).toBe("");
    for (const text of ["", "   ", "\n\t"]) expect(commentTextOf(viewer100(1, text))).toBe("");
    expect(commentTextOf(viewer100(1, "", { content: json({ type: 100 }) }))).toBe("");                 // no text field (a notice)
    expect(commentTextOf(viewer100(1, "", { content: json({ type: 100, content: { text: "x" } }) }))).toBe(""); // text not a string
    expect(commentTextOf(viewer100(1, "", { content: json({ type: 100, content: 5 }) }))).toBe("");
    expect(commentTextOf(viewer100(1, "", { content: json({ type: 100, content_v2: "rich only" }) }))).toBe("");
  });
  it("every message that is not type 100 gives exactly main's answer", () => {
    const contents: unknown[] = [
      json({ type: 101, content: "a" }), json({ type: "101", content: "b" }), json({ type: 101, text: "c" }), json({ type: 101, content: "" }),
      json({ type: 101, content: "  " }), json({ type: 7, content: "joined" }), json({ type: 102, content: "gift" }), json({ type: 99, content: "x" }),
      json({ type: 1000, content: "x" }), json({ type: "abc", content: "x" }), json({ content: "no type" }), json({ type: null, content: "nul" }),
      json({}), "plain", "{broken", " {\"type\":101,\"content\":\"sp\"}", "", null, undefined, 12, [1], { type: 101, content: "obj" },
      { type: 7, content: "o" }, { content: "nt" }, json({ type: 101, content: { x: 1 } }), json({ type: 101.5, content: "f" }),
    ];
    let n = 0;
    for (const c of contents) for (const uid of [HOST_UID, VIEWER_UID, undefined, "", "  "]) {
      const m = { id: 1, uid, content: c };
      expect(commentTextOf(m)).toBe(mainCommentTextOf(m)); n += 1;
    }
    expect(commentTextOf(null)).toBe(mainCommentTextOf(null));
    expect(commentTextOf(undefined)).toBe(mainCommentTextOf(undefined));
    expect(n).toBe(130);
  });
});

describe("V2 through the real reader", () => {
  it("the production case: the host's 2 comments (101) + a viewer's 2 comments (100) → all 4 emitted, in order", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([host101(1, "mine 1"), viewer100(2, "我要 A"), host101(3, "mine 2"), viewer100(4, "+1 B")]) })));
    await h.rt.pollOnce(h.entry());
    expect(comments(h)).toEqual(["mine 1", "我要 A", "mine 2", "+1 B"]);
    expect(h.entry().diag.counts()).toMatchObject({ kept: 4, kept_100: 2, dropped_notext: 0, from_host: 2, from_others: 2 });
    const m = rig(createMain as typeof createBranch);                                                // main: the two viewer comments are lost
    await m.connect();
    m.chat(() => mkRes(200, body({ message: batch([host101(1, "mine 1"), viewer100(2, "我要 A"), host101(3, "mine 2"), viewer100(4, "+1 B")]) })));
    await m.rt.pollOnce(m.entry());
    expect(comments(m)).toEqual(["mine 1", "mine 2"]);
  });
  it("a type-100 comment gets the very payload a type-101 comment with the same fields gets (every field)", async () => {
    const as100 = viewer100(7, "我要 2");
    const as101 = { ...as100, content: json({ type: 101, content: "我要 2", content_v2: "" }) };
    const b = rig(), m = rig(createMain as typeof createBranch);
    for (const [h, msg] of [[b, as100], [m, as101]] as const) { await h.connect(); h.chat(() => mkRes(200, body({ message: batch([msg]) }))); await h.rt.pollOnce(h.entry()); }
    expect(b.emitted).toHaveLength(1);
    expect(b.emitted).toEqual(m.emitted);                                                        // same room, event, payload, scope
    const p = b.emitted[0][2] as Record<string, unknown>;
    expect(p).toMatchObject({ comment: "我要 2", handle: "viewer_a", name: "Viewer A", platform: "Shopee", msgId: "7", isBuy: false, buyerNum: null });
    const ctx = { sellerId: "s", sessionId: "x", uid: HOST_UID, liveSessionId: 8092367, nowMs: 1 };
    expect(shopeeToPayload(as100, ctx)).toEqual(shopeeToPayload(as101, ctx));
    expect(Object.keys(shopeeToPayload(as100, ctx)!).sort()).toEqual(Object.keys(shopeeToPayload(host101(1, "x"), ctx)!).sort());
  });
  it("type 100 without text or without a uid is dropped (no comment, counted as no text)", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([
      viewer100(1, ""), viewer100(2, "   "), viewer100(3, "", { content: json({ type: 100 }) }), viewer100(4, "mine", { uid: undefined }), viewer100(5, "mine", { uid: "" }),
    ]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.emitted).toHaveLength(0);
    expect(h.entry().diag.counts()).toMatchObject({ kept: 0, kept_100: 0, dropped_notext: 5, types: { "100": 5 } });
  });
  it("a repeated type-100 comment is dropped as a repeat, like a 101 (the same dedupe)", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([viewer100(1, "A")]) })));
    await h.rt.pollOnce(h.entry());
    await h.rt.pollOnce(h.entry());
    expect(comments(h)).toEqual(["A"]);
    expect(h.entry().diag.counts()).toMatchObject({ kept: 1, kept_100: 1, dropped_dupe: 1 });
  });
});

// a small deterministic random generator (mulberry32)
function rnd(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
function makeMessage(r: () => number, id: number): M {
  const text = pick(r, ["mine 2", "我要 2", "", "   ", " +1 ", "👍3", "D", "我要"]);
  const type = pick(r, [101, 101, 100, 100, "100", "101", 7, 102, 99, null, undefined]);
  const obj: M = {};
  if (type !== undefined) obj.type = type;
  const textField = pick(r, ["content", "content", "text", "none", "object"]);
  if (textField === "content") obj.content = text; else if (textField === "text") obj.text = text; else if (textField === "object") obj.content = { text };
  if (r() < 0.5) obj.content_v2 = "";
  const content = pick(r, ["json", "json", "json", "json", "object", "plain", "null"]);
  const uid = pick(r, [HOST_UID, HOST_UID, VIEWER_UID, VIEWER_UID, 11111111, undefined, "", "  "]);
  const m: M = {
    id: r() < 0.9 ? id : undefined, uid,
    nickname: pick(r, ["Ana", "", undefined, "B b"]), display_name: pick(r, ["Ana D", undefined]), username: pick(r, ["ana_1", undefined]),
    avatar: pick(r, ["https://cf.shopee.tw/file/z", "", undefined]),
    content: content === "json" ? json(obj) : content === "object" ? obj : content === "plain" ? text : null,
    ts: pick(r, [1793033483 + id, 1793033483000 + id, undefined]), privacy_type: 0,
  };
  if (m.id === undefined) delete m.id;
  return m;
}
// main's reader with every guard-passing type-100 message turned into a 101 (the rule written out again, on its own)
function asMain101(m: M): M {
  const c = m.content;
  let obj: M | null = null, wasString = false;
  if (typeof c === "string" && c.trim().startsWith("{")) { try { const p = JSON.parse(c); if (p && typeof p === "object" && !Array.isArray(p)) { obj = p; wasString = true; } } catch { /* plain */ } }
  else if (c && typeof c === "object" && !Array.isArray(c)) obj = c as M;
  if (!obj || obj.type == null || Number(obj.type) !== 100) return m;
  const text = typeof obj.content === "string" ? obj.content : typeof obj.text === "string" ? obj.text : "";
  const uidOk = m.uid != null && String(m.uid).trim() !== "";
  if (!uidOk || !text.trim()) return m;
  const next = { ...obj, type: 101 };
  return { ...m, content: wasString ? JSON.stringify(next) : next };
}

describe("V3 a generated corpus: branch = main with each real type-100 comment read as a 101", () => {
  it("10 runs, 2,047 messages: same comments (every payload field), statuses, requests, answers, other log lines", async () => {
    let kept100 = 0, dropped100 = 0, total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = rnd(seed);
      const polls: Array<{ message: M[]; e2e: M[] }> = [];
      const all: M[] = [];
      let id = 1;
      for (let p = 0; p < 50; p++) {
        const message: M[] = [], e2e: M[] = [];
        const n = 2 + Math.floor(r() * 6);
        for (let i = 0; i < n; i++) {
          const m = r() < 0.08 && all.length ? pick(r, all) : makeMessage(r, id++);   // ~8 % repeats of an earlier message
          if (!all.includes(m)) all.push(m);
          (r() < 0.8 ? message : e2e).push(m);
        }
        polls.push({ message, e2e });
      }
      const rewrite = new Map(all.map((m) => [m, asMain101(m)]));
      const b = rig(), m = rig(createMain as typeof createBranch);
      const ob: unknown[] = [await b.connect()], om: unknown[] = [await m.connect()];
      for (const p of polls) {
        b.chat(() => mkRes(200, body({ message: batch(p.message), e2e_message: batch(p.e2e) })));
        m.chat(() => mkRes(200, body({ message: batch(p.message.map((x) => rewrite.get(x)!)), e2e_message: batch(p.e2e.map((x) => rewrite.get(x)!)) })));
        ob.push(await b.rt.pollOnce(b.entry())); om.push(await m.rt.pollOnce(m.entry()));
        b.tick(4000); m.tick(4000);
      }
      b.rt.stopPoller(b.entry().key, "session_end"); m.rt.stopPoller(m.entry().key, "session_end");
      expect(b.emitted).toEqual(m.emitted);
      expect(b.statuses).toEqual(m.statuses);
      expect(b.urls).toEqual(m.urls);
      expect(ob).toEqual(om);
      expect(b.logs.filter((l) => !l.startsWith("[SHOPEE-DIAG]"))).toEqual(m.logs);
      const c = b.entry()?.diag?.counts?.() ?? null;
      expect(c).toBeNull();                                                                       // the poller is gone after stop
      const lastLine = b.diagLines().at(-1)!;
      kept100 += Number(field(lastLine, "kept_100"));
      dropped100 += all.filter((x) => rewrite.get(x) === x && isType100(x)).length;
      total += all.length;
    }
    expect(total).toBeGreaterThan(1900);                                                        // 2,047 messages in the 10 runs
    expect(kept100).toBeGreaterThan(100);                                                       // 110 real type-100 comments kept …
    expect(dropped100).toBeGreaterThan(250);                                                    // … and 283 type-100 notices dropped
  });
  it("without any type-100 message the branch emits exactly what main emits (the host's 101 unchanged)", async () => {
    const r = rnd(42);
    const msgs: M[] = [];
    for (let i = 1; msgs.length < 300; i++) { const x = makeMessage(r, i); if (!isType100(x)) msgs.push(x); }
    const b = rig(), m = rig(createMain as typeof createBranch);
    for (const h of [b, m]) { await h.connect(); for (let i = 0; i < msgs.length; i += 5) { h.chat(() => mkRes(200, body({ message: batch(msgs.slice(i, i + 5)) }))); await h.rt.pollOnce(h.entry()); h.tick(4000); } }
    expect(b.emitted.length).toBeGreaterThan(50);
    expect(b.emitted).toEqual(m.emitted);
    expect(b.logs.filter((l) => !l.startsWith("[SHOPEE-DIAG]"))).toEqual(m.logs);
  });
});

describe("V4 the diagnostic", () => {
  it("contentPaths: names only, nested objects and arrays, maps and long lists capped; never a value", () => {
    expect(contentPaths({ type: 100, content: "x", content_v2: "" })).toEqual(["type", "content", "content_v2"]);
    expect(contentPaths({ type: 100, content: { text: "x", seg: [{ t: 1, u: { v: 2 } }] } })).toEqual(["type", "content", "content.text", "content.seg[]", "content.seg[].t", "content.seg[].u", "content.seg[].u.v"]);
    expect(contentPaths({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual(["a", "a.b", "a.b.c", "a.b.c.d"]);
    expect(contentPaths({ list: [1, "x", null] })).toEqual(["list[]"]);
    expect(contentPaths({ m: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`buyer${i}`, 1])) })).toEqual(["m", "m.many:20"]);
    expect(contentPaths({ user_254298659: 1, "a b": 2, ok: 3 })).toEqual(["?", "?", "ok"]);
    expect(contentPaths({ content: "{\"jeff_word\":1}" })).toEqual(["content"]);                // a comment typed as JSON is never parsed
    const wide = contentPaths(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${String.fromCharCode(97 + i)}`, { x: 1, y: 2, z: 3 }])));
    expect(wide).toHaveLength(DIAG_PATHS_MAX + 1);
    expect(wide.at(-1)).toBe(`+${32 - DIAG_PATHS_MAX}`);
    expect(contentPaths(null)).toEqual([]);
    expect(contentPaths([{ a: 1 }])).toEqual([]);
  });
  it("kept_100 and keys_100 in the line; a new type-100 shape writes a line at once", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([host101(1, "mine")]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(1);
    expect([field(h.diagLines()[0], "kept_100"), field(h.diagLines()[0], "keys_100")]).toEqual(["0", "-"]);
    h.chat(() => mkRes(200, body({ message: batch([viewer100(2, "A")]) })));
    h.tick(3000); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(2);
    expect([field(h.diagLines()[1], "kept_100"), field(h.diagLines()[1], "keys_100")]).toEqual(["1", "type,content,content_v2"]);
    h.chat(() => mkRes(200, body({ message: batch([viewer100(3, "B")]) })));                       // same shape → no new line
    h.tick(3000); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(2);
    h.chat(() => mkRes(200, body({ message: batch([viewer100(4, "", { content: json({ type: 100, info: { n: 1 } }) })]) })));
    h.tick(3000); await h.rt.pollOnce(h.entry());                                                // a dropped type-100 notice: its shape too
    expect(h.diagLines()).toHaveLength(3);
    expect(field(h.diagLines()[2], "keys_100")).toBe("type,content,content_v2|type,info,info.n");
    expect(field(h.diagLines()[2], "kept_100")).toBe("2");
    expect(h.diagLines()[2].endsWith(" kept_100=2 keys_100=type,content,content_v2|type,info,info.n")).toBe(true);
  });
  it("type-100 shapes have their own budget (a line even after the other shape lines ran out); at most 4 listed, then +n", async () => {
    const h = rig();
    await h.connect();
    for (let i = 0; i < DIAG_SHAPE_LINES_MAX + 2; i++) { h.chat(() => mkRes(200, body({ message: batch([host101(i + 1, "", { content: json({ type: 200 + i, content: "x" }) })]) }))); h.tick(100); await h.rt.pollOnce(h.entry()); }
    expect(h.diagLines()).toHaveLength(DIAG_SHAPE_LINES_MAX);                                     // the general budget is used up
    const before = h.diagLines().length;
    for (let i = 0; i < DIAG_100_SHAPES_MAX + 2; i++) { h.chat(() => mkRes(200, body({ message: batch([viewer100(100 + i, "A", { content: json({ type: 100, content: "A", [`f${String.fromCharCode(97 + i)}`]: 1 }) })]) }))); h.tick(100); await h.rt.pollOnce(h.entry()); }
    expect(h.diagLines().length - before).toBe(DIAG_100_SHAPES_MAX);                             // one line per new type-100 shape, 4 at most
    expect(field(h.diagLines().at(-1)!, "keys_100")).toBe("type,content,fa|type,content,fb|type,content,fc|type,content,fd");
    h.tick(DIAG_EVERY_MS); h.chat(() => mkRes(200, body({ message: [] }))); await h.rt.pollOnce(h.entry());
    expect(field(h.diagLines().at(-1)!, "keys_100")).toBe("type,content,fa|type,content,fb|type,content,fc|type,content,fd|+2");
  });
  it("no comment text, name, username, uid, avatar or link in a line with type-100 messages", async () => {
    const h = rig();
    await h.connect();
    const SECRET = "MARK-viewer-text";
    h.chat(() => mkRes(200, body({ message: batch([
      viewer100(1, SECRET), viewer100(2, `{"${"markword"}":1}`), viewer100(3, "", { content: json({ type: 100, content: SECRET, sender: { name: "MarkName", uid: VIEWER_UID } }) }),
      viewer100(4, SECRET, { content: { type: 100, content: SECRET, [`u_${VIEWER_UID}`]: 1 } }),
    ]) })));
    await h.rt.pollOnce(h.entry());
    h.rt.stopPoller(h.entry().key, "stopped");
    const all = h.diagLines().join("\n");
    for (const v of [SECRET, "markword", "MarkName", "Viewer A", "viewer_a", String(VIEWER_UID), String(HOST_UID), "cf.shopee", "https://", "8092367", "SPIM-ROOM", "browser-abc"]) expect(all).not.toContain(v);
    expect(all).not.toMatch(/\d{5,}/);
    expect(field(h.diagLines().at(-1)!, "keys_100")).toBe("type,content,content_v2|type,content,sender,sender.name,sender.uid|type,content,?");
  });
  it("the old counters are exactly main's (same messages, same outcomes: every count, the line, when it is written)", () => {
    for (const seed of [3, 4, 5]) {
      const r = rnd(seed);
      const b = createShopeeDiag({ hostUid: String(HOST_UID), startMs: 0 }), m = createMainDiag({ hostUid: String(HOST_UID), startMs: 0 });
      const lb: string[] = [], lm: string[] = [];
      let t = 0;
      for (let p = 0; p < 200; p++) {
        const msgs = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => makeMessage(r, p * 10 + i));
        const data = { message: batch(msgs.filter((_, i) => i % 3 !== 2)), e2e_message: batch(msgs.filter((_, i) => i % 3 === 2)), system: batch(r() < 0.2 ? [msgs[0]] : []), timestamp: 1, poll_interval: 3, ...(r() < 0.02 ? { extra_list: [] } : {}) };
        for (const d of [b, m]) { d.poll(); d.data(data); }
        for (const x of msgs) { const out = pick(r, ["kept", "kept", "notext", "dupe"]); const id = String(x.id ?? "n"); b.msg(x, out, id); m.msg(x, out, id); }
        t += 1000 + Math.floor(r() * 4000);
        b.maybeLog(t, (l: string) => lb.push(l), "s");
        m.maybeLog(t, (l: string) => lm.push(l), "s");
      }
      const { kept_100: _k, keys100: _p, ...oldB } = b.counts();
      expect(oldB).toEqual(m.counts());
      expect(b.line("s").replace(/ kept_100=\S+ keys_100=\S+$/, "")).toBe(m.line("s"));
      // every line main writes, the branch writes too, with the same old counts (it may write a few more: new type-100 shapes)
      const strip = (l: string) => l.replace(/ kept_100=\S+ keys_100=\S+$/, "");
      const sb = lb.map(strip);
      expect(lb.length).toBeGreaterThanOrEqual(lm.length);
      for (const l of lm.slice(0, 3)) expect(sb).toContain(l);
    }
  });
  it("with no type-100 message the lines are main's, line for line and at the same times", () => {
    const r = rnd(9);
    const b = createShopeeDiag({ hostUid: String(HOST_UID), startMs: 0 }), m = createMainDiag({ hostUid: String(HOST_UID), startMs: 0 });
    const lb: string[] = [], lm: string[] = [];
    let t = 0, id = 1;
    for (let p = 0; p < 300; p++) {
      const msgs: M[] = [];
      while (msgs.length < 3) { const x = makeMessage(r, id++); if (!isType100(x)) msgs.push(x); }
      for (const d of [b, m]) { d.poll(); d.data({ message: batch(msgs) }); }
      for (const x of msgs) { const out = pick(r, ["kept", "notext", "dupe"]); b.msg(x, out, String(x.id)); m.msg(x, out, String(x.id)); }
      t += 2000 + Math.floor(r() * 5000);
      b.maybeLog(t, (l: string) => lb.push(l), "s");
      m.maybeLog(t, (l: string) => lm.push(l), "s");
    }
    expect(lm.length).toBeGreaterThan(20);
    expect(lb.map((l) => l.replace(/ kept_100=0 keys_100=-$/, ""))).toEqual(lm);
    expect(lb.every((l) => l.endsWith(" kept_100=0 keys_100=-"))).toBe(true);
  });
});
