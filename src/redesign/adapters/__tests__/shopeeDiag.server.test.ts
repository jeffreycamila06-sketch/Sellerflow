// @vitest-environment node
// Shopee Live — the [SHOPEE-DIAG] counters (server/shopeeDiag.js, wired in server/shopeeLiveLink.js). Log only:
//   D1  the walk = the reader's walk (same messages, same order); the shape of one message
//   D2  the counters through the REAL reader: message vs e2e (and the unread system list), type 101 vs other,
//       host vs others vs no uid, kept / no text / repeat / same id on a different message, unknown field names
//   D3  when a line is written (new shape at once, then every 60 s, at stop), and that it holds no private data
//   D4  the reader does exactly what main's reader does with the diagnostic on: same comments (payloads), same
//       statuses, same requests, same answers — and a throw inside the diagnostic changes nothing
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bucketMsgs, messageShape, typeWord, safeKeyName, createShopeeDiag, DIAG_EVERY_MS, DIAG_SHAPE_LINES_MAX, KNOWN_MSG_KEYS,
} from "../../../../server/shopeeDiag.js";
import { parseChatBatches, createShopeeLinkRuntime as createBranch, MAX_CONSECUTIVE_FAILS, STATUS_RECHECK_MS, IDLE_STOP_MS } from "../../../../server/shopeeLiveLink.js";
import { createShopeeLinkRuntime as createMain } from "./fixtures/shopeeLiveLink.main.js";

// none of these may ever be in a log line
const HOST_UID = 254298659;
const MARK = { text: "MARKTEXT-mine-2", nick: "MarkNick", user: "markuser", avatar: "https://cf.shopee.tw/file/MARKAVATAR", chatroom: "SPIM-MARKROOM77", other: 98765432, link: "share_user_id" };
const TW_LINK = `https://live.shopee.tw/share?from=live&session=8092367&share_user_id=${HOST_UID}`;
const hostBody = (over: Record<string, unknown> = {}) => ({ err_code: 0, data: { session: { session_id: 8092367, uid: HOST_UID, status: 1, chatroom_id: MARK.chatroom, title: "sale", ...over } } });
type M = Record<string, unknown>;
const msg = (id: number | string | undefined, text: string, o: M = {}): M => ({
  ...(id === undefined ? {} : { id }), uid: HOST_UID, nickname: MARK.nick, display_name: MARK.nick, avatar: MARK.avatar,
  content: JSON.stringify({ type: 101, content: text, content_v2: "" }), ts: 1793033483, privacy_type: 0, ...o,
});
const viewer = (id: number, text: string, o: M = {}) => msg(id, text, { uid: MARK.other, nickname: MARK.user, username: MARK.user, ...o });
const body = (d: M) => ({ code: 0, msg: "success", data: { timestamp: 1793033485, poll_interval: 3, ...d } });
const batch = (msgs: M[]) => [{ msgs, timestamp: 1793033485 }];
const mkRes = (status: number, b: unknown) => ({ status, json: async () => b, headers: { get: () => null } });

describe("D1 the walk and the shape of one message", () => {
  it("bucketMsgs over message + e2e_message = exactly what parseChatBatches reads (same objects, same order)", () => {
    const a = msg(1, "a"), b = msg(2, "b"), c = msg(3, "c"), e = msg(4, "e"), f = msg(5, "f");
    const shapes: M[] = [
      { message: batch([a, b]), e2e_message: batch([c]) },
      { message: { msgs: [a] }, e2e_message: [{ msgs: [b, c] }, { msgs: [e] }] },
      { message: [[a, b]], e2e_message: {} },
      { message: [], e2e_message: { msgs: [f, null, 7] } },
      { message: { other: 1 } },
      {}, { message: "x" }, { message: [null, { msgs: "x" }] },
    ];
    for (const d of shapes) {
      expect([...bucketMsgs(d, "message"), ...bucketMsgs(d, "e2e_message")]).toEqual(parseChatBatches(d).msgs);
      const got = [...bucketMsgs(d, "message"), ...bucketMsgs(d, "e2e_message")];
      parseChatBatches(d).msgs.forEach((m: M, i: number) => expect(got[i]).toBe(m)); // the very same objects
    }
    expect(bucketMsgs(null, "message")).toEqual([]);
    expect(bucketMsgs({ system: batch([a]) }, "system")).toEqual([a]);
  });
  it("messageShape: content kind, type, sender, unknown field names", () => {
    expect(messageShape(msg(1, "x"), String(HOST_UID))).toEqual({ content: "json", type: "101", who: "host", unknownKeys: [] });
    expect(messageShape(viewer(1, "x"), String(HOST_UID))).toEqual({ content: "json", type: "101", who: "others", unknownKeys: ["username"] });
    expect(messageShape(msg(1, "", { uid: undefined }), String(HOST_UID)).who).toBe("nouid");
    expect(messageShape(msg(1, "", { content: JSON.stringify({ type: 7, content: "joined" }) }), "1").type).toBe("7");
    expect(messageShape(msg(1, "", { content: JSON.stringify({ content: "no type" }) }), "1").type).toBe("none");
    expect(messageShape(msg(1, "", { content: "plain text" }), "1")).toMatchObject({ content: "string", type: "na" });
    expect(messageShape(msg(1, "", { content: "{broken" }), "1").content).toBe("string");
    expect(messageShape(msg(1, "", { content: { type: 101, text: "x" } }), "1")).toMatchObject({ content: "object", type: "101" });
    expect(messageShape(msg(1, "", { content: [1] }), "1").content).toBe("other");
    expect(messageShape(msg(1, "", { content: undefined, type: 5 }), "1")).toMatchObject({ content: "other", type: "5" });
    expect(messageShape(msg(1, "", { content: 12 }), "1")).toMatchObject({ content: "other", type: "na" });
    expect(KNOWN_MSG_KEYS).toEqual(["id", "uid", "nickname", "display_name", "avatar", "content", "ts", "privacy_type"]);
  });
  it("typeWord / safeKeyName never let a number that could be a uid or a strange name through", () => {
    expect([typeWord(101), typeWord("7"), typeWord(null), typeWord(""), typeWord(254298659), typeWord(-1), typeWord("abc"), typeWord(1.5)]).toEqual(["101", "7", "none", "none", "other", "other", "other", "other"]);
    expect([safeKeyName("sender_uid"), safeKeyName("user_254298659"), safeKeyName("a b"), safeKeyName("9x"), safeKeyName("x".repeat(40)), safeKeyName("v2")]).toEqual(["sender_uid", "?", "?", "?", "?", "v2"]);
  });
});

// the REAL reader with a scripted chat room
function rig(o: { diag?: boolean; make?: typeof createBranch } = {}) {
  const logs: string[] = [], emitted: unknown[][] = [], statuses: unknown[][] = [], urls: string[] = [];
  let t = 1_000_000;
  let chat: () => unknown = () => mkRes(200, body({}));
  let host: () => unknown = () => mkRes(200, hostBody());
  const fetchImpl = vi.fn(async (u: string) => { urls.push(u); return u.includes("host_session") ? host() : u.includes("/message?") ? chat() : mkRes(404, null); });
  const make = o.make ?? createBranch;
  const rt = make({
    emitComment: (...a: unknown[]) => emitted.push(a), statusEmit: (...a: unknown[]) => statuses.push(JSON.parse(JSON.stringify(a))), rememberAccount: async () => {},
    fetchImpl, now: () => t, log: (l: string) => logs.push(l), liveKey: (s: string, p: string, k: string) => `${s}:${p}:${k}`,
    enabled: async () => true, betaAllowed: async () => true, setLoop: () => 1, clearLoop: () => {},
    ...(o.diag === undefined ? {} : { diag: o.diag }),
  });
  return {
    rt, logs, emitted, statuses, urls, diagLines: () => logs.filter((l) => l.startsWith("[SHOPEE-DIAG]")),
    at: () => t, tick: (ms: number) => { t += ms; },
    chat: (f: () => unknown) => { chat = f; }, host: (f: () => unknown) => { host = f; },
    connect: () => rt.connect({ sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc", shareLink: TW_LINK }),
    entry: () => [...rt._pollers.values()][0],
  };
}
const field = (line: string, k: string) => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(line) || [])[1];

describe("D2 the counters through the real reader", () => {
  it("message vs e2e (and the system list the reader never reads); type 101 vs other; host vs others vs no uid", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({
      message: batch([msg(1, "host 1"), viewer(2, "viewer 2"), msg(3, "", { content: JSON.stringify({ type: 7, content: "joined" }), uid: MARK.other })]),
      e2e_message: batch([viewer(4, "e2e viewer"), msg(5, "no uid", { uid: undefined })]),
      system: batch([viewer(6, "sys 1"), viewer(7, "sys 2")]),
    })));
    await h.rt.pollOnce(h.entry());
    const c = h.entry().diag.counts();
    expect(c).toMatchObject({ polls: 1, msgs_message: 3, msgs_e2e: 2, msgs_system: 2, from_host: 1, from_others: 3, from_nouid: 1, kept: 4, dropped_notext: 1, dropped_dupe: 0 });
    expect(c.types).toEqual({ "101": 4, "7": 1 });
    expect(c.content).toEqual({ json: 5, string: 0, object: 0, other: 0 });
    expect(h.emitted.map((e) => (e[2] as { comment: string }).comment)).toEqual(["host 1", "viewer 2", "e2e viewer", "no uid"]); // = what the reader always emitted
    const line = h.diagLines()[0];
    expect(line).toBe("[SHOPEE-DIAG] seller=seller-1 polls=1 msgs_message=3 msgs_e2e=2 msgs_system=2 types=101:4,7:1 content=json:5,string:0,object:0,other:0 from_host=1 from_others=3 from_nouid=1 kept=4 dropped_notext=1 dropped_dupe=0 dupe_collide=0 keys_unknown=username");
  });
  it("only the host's messages arrive (the case seen in production) → from_others stays 0", async () => {
    const h = rig();
    await h.connect();
    for (let i = 1; i <= 5; i++) { h.chat(() => mkRes(200, body({ message: batch([msg(i, `mine ${i}`)]) }))); await h.rt.pollOnce(h.entry()); h.tick(3000); }
    h.tick(DIAG_EVERY_MS);
    h.chat(() => mkRes(200, body({ message: [] })));
    await h.rt.pollOnce(h.entry());
    const last = h.diagLines().at(-1)!;
    expect([field(last, "polls"), field(last, "from_host"), field(last, "from_others"), field(last, "kept"), field(last, "keys_unknown")]).toEqual(["6", "5", "0", "5", "-"]);
  });
  it("repeats: the same message in the next poll = dropped_dupe; a DIFFERENT message with an id already used = dupe_collide too", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([msg(1, "host 1"), viewer(2, "viewer 2")]) })));
    await h.rt.pollOnce(h.entry());
    h.chat(() => mkRes(200, body({ message: batch([msg(1, "host 1"), viewer(1, "another viewer, same id"), msg(2, "host reuses id 2")]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.entry().diag.counts()).toMatchObject({ kept: 2, dropped_dupe: 3, dupe_collide: 2 });
    expect(h.emitted).toHaveLength(2); // the reader's dedupe is unchanged: the colliding messages are still dropped
  });
  it("a message whose id is missing gets uid-ts as its key; two viewers at the same second each keep theirs (no false collision)", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([viewer(0, "x"), { ...viewer(0, "y"), uid: 11111111 }].map((m) => { const c = { ...m }; delete c.id; return c; })) })));
    await h.rt.pollOnce(h.entry());
    expect(h.entry().diag.counts()).toMatchObject({ kept: 2, dropped_dupe: 0, from_others: 2 });
  });
  it("no text: a non-101 type, an empty comment, a content with no text field → dropped_notext", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([
      viewer(1, "", { content: JSON.stringify({ type: 102, content: "gift" }) }),
      viewer(2, ""),
      viewer(3, "", { content: JSON.stringify({ type: 101, content_v2: "rich only" }) }),
    ]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.entry().diag.counts()).toMatchObject({ kept: 0, dropped_notext: 3, from_others: 3, types: { "101": 2, "102": 1 } });
    expect(h.emitted).toHaveLength(0);
  });
  it("keys_unknown = the field NAMES of the first unknown shape (data level too); never a value", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([msg(1, "a", { sender: { uid: 1 }, extra_254298659: 1 })]) })));
    await h.rt.pollOnce(h.entry());
    expect(field(h.diagLines()[0], "keys_unknown")).toBe("sender,?");
    const g = rig();
    await g.connect();
    g.chat(() => mkRes(200, body({ message: batch([msg(1, "a")]), comments: [], live_msgs: {} })));
    await g.rt.pollOnce(g.entry());
    expect(field(g.diagLines()[0], "keys_unknown")).toBe("data.comments,data.live_msgs");
  });
  it("other content kinds are counted: plain string, object, other", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: batch([viewer(1, "", { content: "plain" }), viewer(2, "", { content: { type: 101, content: "obj" } }), viewer(3, "", { content: null })]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.entry().diag.counts()).toMatchObject({ content: { json: 0, string: 1, object: 1, other: 1 }, kept: 2, dropped_notext: 1 });
  });
});

describe("D3 when a line is written, and what it never holds", () => {
  it("at once on the first message shape, again on a new shape (a viewer's first message), then every 60 s; one more at stop", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(200, body({ message: [] })));
    await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(0);                              // nothing seen yet, 60 s not passed
    h.chat(() => mkRes(200, body({ message: batch([msg(1, "a")]) })));
    await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(1);                              // first shape → at once
    h.chat(() => mkRes(200, body({ message: batch([msg(2, "b")]) })));
    h.tick(3000); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(1);                              // same shape → no line
    h.chat(() => mkRes(200, body({ message: batch([viewer(3, "c")]) })));
    h.tick(3000); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(2);                              // a viewer's message is a new shape → at once
    h.chat(() => mkRes(200, body({ message: [] })));
    h.tick(DIAG_EVERY_MS - 1); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(2);
    h.tick(1); await h.rt.pollOnce(h.entry());
    expect(h.diagLines()).toHaveLength(3);                              // 60 s after the last line
    h.rt.stopPoller(h.entry().key, "session_end");
    expect(h.diagLines()).toHaveLength(4);                              // the last count at stop
    expect(h.logs.indexOf("[SHOPEE-LINK] poller stop seller=seller-1 reason=session_end")).toBe(h.logs.length - 2);
  });
  it("new-shape lines stop after DIAG_SHAPE_LINES_MAX (the 60 s line still comes)", async () => {
    const h = rig();
    await h.connect();
    for (let i = 0; i < 30; i++) { h.chat(() => mkRes(200, body({ message: batch([msg(i + 1, "", { content: JSON.stringify({ type: 200 + i, content: "x" }) })]) }))); h.tick(3000); await h.rt.pollOnce(h.entry()); }
    expect(h.diagLines()).toHaveLength(DIAG_SHAPE_LINES_MAX + 1);       // 10 shape lines + the 60 s line (30 × 3 s = 90 s)
  });
  it("failing polls are counted; the 60 s line still comes while the chat room is down", async () => {
    const h = rig();
    await h.connect();
    h.chat(() => mkRes(503, null));
    for (let i = 0; i < MAX_CONSECUTIVE_FAILS - 1; i++) { await h.rt.pollOnce(h.entry()); h.tick(8000); } // polls at 0, 8 … 64 s
    expect(h.diagLines()).toHaveLength(1);
    expect([field(h.diagLines()[0], "polls"), field(h.diagLines()[0], "kept")]).toEqual(["9", "0"]);
  });
  it("no comment text, name, username, uid, avatar, link, chatroom id or uuid in any [SHOPEE-DIAG] line", async () => {
    const h = rig();
    await h.connect();
    const mapLike = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${MARK.user}${i}`, 1]));   // a message that is really a map keyed by names
    h.chat(() => mkRes(200, body({ message: batch([msg(1, MARK.text), viewer(2, MARK.text, { [`u_${MARK.other}`]: 1 }), { ...viewer(5, MARK.text), ...mapLike }]), e2e_message: batch([viewer(3, MARK.text)]) })));
    await h.rt.pollOnce(h.entry());
    h.tick(DIAG_EVERY_MS); await h.rt.pollOnce(h.entry());
    h.rt.stopPoller(h.entry().key, "stopped");
    const all = h.diagLines().join("\n");
    expect(h.diagLines().length).toBeGreaterThan(1);
    for (const v of [MARK.text, MARK.nick, MARK.user, MARK.chatroom, MARK.avatar, "cf.shopee", String(HOST_UID), String(MARK.other), "8092367", "00000000", "browser-abc", "share_user_id", "https://"]) expect(all).not.toContain(v);
    expect(all).not.toMatch(/\d{5,}/);                                  // no long number at all (a uid / session / chat room)
    expect(all).toContain("keys_unknown=username,?");                   // the first unknown shape: a known-looking name + a uid-like name hidden
    const d = createShopeeDiag({ hostUid: "1" });
    d.msg({ ...viewer(5, "x"), ...mapLike }, "kept", "5");
    expect(d.counts().keysUnknown).toEqual(["many:21"]);                // a map keyed by names → only its size
  });
});

describe("D4 the reader does exactly what main's reader does, with the diagnostic on", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => { spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000"); });
  afterEach(() => { spy?.mockRestore(); });
  async function script(h: ReturnType<typeof rig>) {
    const out: unknown[] = [];
    out.push(await h.connect());
    const steps: Array<() => unknown> = [
      () => mkRes(200, body({ message: batch([msg(1, "mine 1"), viewer(2, "viewer 2")]), e2e_message: batch([viewer(3, "e2e")]), system: batch([viewer(4, "sys")]) })),
      () => mkRes(200, body({ message: batch([msg(1, "mine 1"), viewer(1, "collides"), msg(5, "", { content: JSON.stringify({ type: 7, content: "join" }) })]) })),
      () => mkRes(503, null),
      () => mkRes(200, { code: 1000000, msg: "params invalid" }),
      () => mkRes(200, body({ message: batch([viewer(6, "", { content: "plain" }), viewer(7, "", { content: { type: 101, content: "obj" } }), { ...viewer(8, "no id"), id: undefined }]), poll_interval: 8 })),
      () => mkRes(200, body({ message: [] , timestamp: 1793033999 })),
    ];
    for (const s of steps) { h.chat(s); out.push(await h.rt.pollOnce(h.entry())); h.tick(4000); }
    h.tick(STATUS_RECHECK_MS); h.host(() => mkRes(200, hostBody())); out.push(await h.rt.pollOnce(h.entry()));
    h.tick(IDLE_STOP_MS); h.chat(() => mkRes(200, body({ message: [] }))); out.push(await h.rt.pollOnce(h.entry()));
    h.host(() => mkRes(200, hostBody({ status: 2 }))); h.tick(STATUS_RECHECK_MS); out.push(await h.rt.pollOnce(h.entry()));
    h.rt.stopPoller(h.entry().key, "session_end");
    return out;
  }
  it("same comments (every payload field), same statuses, same requests, same answers, same other log lines", async () => {
    const b = rig(), m = rig({ make: createMain as typeof createBranch });
    const ob = await script(b), om = await script(m);
    expect(b.emitted.length).toBeGreaterThan(5);
    expect(b.emitted).toEqual(m.emitted);
    expect(b.statuses).toEqual(m.statuses);
    expect(b.urls).toEqual(m.urls);
    expect(ob).toEqual(om);
    expect(b.logs.filter((l) => !l.startsWith("[SHOPEE-DIAG]"))).toEqual(m.logs);
    expect(b.diagLines().length).toBeGreaterThan(0);
    expect(m.logs.some((l) => l.startsWith("[SHOPEE-DIAG]"))).toBe(false);
  });
  it("diag: false = main, log line for log line", async () => {
    const b = rig({ diag: false }), m = rig({ make: createMain as typeof createBranch });
    await script(b); await script(m);
    expect(b.logs).toEqual(m.logs);
    expect(b.emitted).toEqual(m.emitted);
  });
  it("a throw inside the diagnostic changes nothing: the comment is still emitted, the poll answers the same", async () => {
    const b = rig(), m = rig({ make: createMain as typeof createBranch });
    const poison = () => new Proxy(viewer(9, "still here"), { ownKeys: () => { throw new Error("diag boom"); } });
    for (const h of [b, m]) { await h.connect(); h.chat(() => mkRes(200, body({ message: batch([poison()]) }))); }
    const rb = await b.rt.pollOnce(b.entry()), rm = await m.rt.pollOnce(m.entry());
    expect(rb).toEqual(rm);
    expect(b.emitted).toEqual(m.emitted);
    expect((b.emitted[0][2] as { comment: string }).comment).toBe("still here");
  });
});

describe("the diagnostic object on its own", () => {
  it("60 s cadence from the poller start; counts() is a copy", () => {
    const d = createShopeeDiag({ hostUid: "1", startMs: 0 });
    const lines: string[] = [];
    d.poll();
    expect(d.maybeLog(DIAG_EVERY_MS - 1, (l: string) => lines.push(l), "s")).toBe(false);
    expect(d.maybeLog(DIAG_EVERY_MS, (l: string) => lines.push(l), "s")).toBe(true);
    expect(lines[0]).toBe("[SHOPEE-DIAG] seller=s polls=1 msgs_message=0 msgs_e2e=0 msgs_system=0 types=- content=json:0,string:0,object:0,other:0 from_host=0 from_others=0 from_nouid=0 kept=0 dropped_notext=0 dropped_dupe=0 dupe_collide=0 keys_unknown=-");
    const c = d.counts(); c.polls = 99;
    expect(d.counts().polls).toBe(1);
  });
});
