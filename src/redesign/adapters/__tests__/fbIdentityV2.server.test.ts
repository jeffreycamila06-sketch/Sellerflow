// @vitest-environment node
// Build 4 — "Facebook identity v2" (fb_identity_v2), server half. Pins:
//   • fbToPayload OFF (no flag / false) = today's payload, byte-identical; ON: handle = from.id,
//     "fb-anon-<comment id>" when Facebook hides the commenter; name / commenterId / every other
//     key unchanged;
//   • the mode is read ONCE per Connect and FIXED for that poller: a poller started OFF keeps
//     names after the switch reads ON; a re-Connect to the same live keeps the running mode;
//     a new live (or a fresh Connect) takes the switch as it is then; pollOnce never reads it;
//   • any error reading the switch = OFF;
//   • server.js wires a third cached reader for "fb_identity_v2" (no harness → source contract).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fbToPayload } from "../../../../server/fbComment.js";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CTX = { sellerId: "s", sessionId: "S1", pageId: "P1", liveVideoId: "LV1", pageUsername: "mypage", nowMs: 1_760_000_000_000 };
const named = { id: "LV1_901", message: "mine A01", from: { id: "1029384756473829", name: "Maria Santos" }, created_time: "2026-10-09T12:00:00+0000" };
const hidden = { id: "LV1_902", message: "mine A02", created_time: "2026-10-09T12:00:01+0000" };

describe("fbToPayload", () => {
  it("OFF (no flag, false, or not exactly true) → today's payload exactly", () => {
    const today = fbToPayload(named, CTX);
    expect(today.handle).toBe("Maria Santos");
    for (const v of [false, undefined, "true", 1]) expect(fbToPayload(named, { ...CTX, identityV2: v })).toEqual(today);
    expect(fbToPayload(hidden, CTX).handle).toBe("unknown");
    expect(fbToPayload(hidden, { ...CTX, identityV2: false })).toEqual(fbToPayload(hidden, CTX));
  });
  it("ON → handle = the commenter id; name and commenterId unchanged; nothing else changes", () => {
    const off = fbToPayload(named, CTX);
    const on = fbToPayload(named, { ...CTX, identityV2: true });
    expect(on.handle).toBe("1029384756473829");
    expect(on.name).toBe("Maria Santos");
    expect(on.commenterId).toBe("1029384756473829");
    expect({ ...on, handle: off.handle }).toEqual(off);
    expect(Object.keys(on)).toEqual(Object.keys(off));
  });
  it("ON + hidden commenter → its own buyer per comment ('fb-anon-<comment id>'), name 'Unknown'", () => {
    const a = fbToPayload(hidden, { ...CTX, identityV2: true });
    const b = fbToPayload({ ...hidden, id: "LV1_903" }, { ...CTX, identityV2: true });
    expect(a.handle).toBe("fb-anon-LV1_902");
    expect(b.handle).toBe("fb-anon-LV1_903");
    expect(a.name).toBe("Unknown");
    expect(a.commenterId).toBe("");
    expect({ ...a, handle: "unknown" }).toEqual(fbToPayload(hidden, CTX));
  });
  it("ON + id but no name → handle = id, name 'Unknown' (same as today's handle)", () => {
    const r = { id: "LV1_904", message: "x", from: { id: "77" } };
    expect(fbToPayload(r, { ...CTX, identityV2: true }).handle).toBe("77");
    expect(fbToPayload(r, CTX).handle).toBe("77");
  });
});

// ── poller mode fixed at Connect ─────────────────────────────────────────────
const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
type Handler = (req: unknown, res: unknown, next: () => void) => unknown;

function rig(flag: () => Promise<unknown>) {
  const live = { id: "LV1" };
  let seq = 0;
  let comments: unknown[] = [];
  const say = () => { seq++; comments = [{ id: `${live.id}_${seq}`, message: "mine", from: { id: "1029384756473829", name: "Maria Santos" }, created_time: "2026-10-09T12:00:00+0000" }, ...comments]; };
  const fetchImpl = vi.fn(async (url: string) => {
    if (/\/comments\?/.test(url)) return mkRes(200, { data: comments });
    if (/live_videos/.test(url)) return mkRes(200, { data: [{ id: live.id, status: "LIVE" }] });
    return mkRes(200, { status: "LIVE" });
  });
  const store = {
    async getPage() { return { user_id: "u1", page_id: "P1", page_username: "mypage", active: true, access_token: encryptToken("TOK", CONFIG.tokenKey), token_expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() }; },
    async listActivePages() { return []; },
  };
  const emitComment = vi.fn();
  const identityV2Enabled = vi.fn(flag);
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment, statusEmit: vi.fn(), liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => 1_000_000, log: () => {}, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
    identityV2Enabled,
  });
  const handlers: Record<string, Handler[]> = {};
  const rec = (m: string) => (p: string, ...h: Handler[]) => { handlers[`${m} ${p}`] = h; };
  const pass: Handler = (_q, _s, next) => next();
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, pass as never, {
    requireFbAvailable: pass, requireConnectRate: pass, requirePlanActive: pass, requireFbPlan: pass, accountLiveCheck: async () => ({ allow: true }),
  } as never);
  async function connect() {
    const chain = handlers["POST /fb/connect"];
    let json: Record<string, unknown> = {};
    const res = { status() { return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
    for (let i = 0; i < chain.length - 1; i++) await chain[i]({}, res, () => {});
    await chain[chain.length - 1]({ authUserId: "u1", sellerId: "s", body: { page_id: "P1", sessionId: "S1" } }, res, () => {});
    return json;
  }
  const entry = () => rt._pollers.get(liveKey("s", "Facebook", "P1"));
  const pollHandles = async () => { const n0 = emitComment.mock.calls.length; await rt.pollOnce(entry()); return emitComment.mock.calls.slice(n0).map((c) => c[2].handle); };
  return { live, say, connect, entry, pollHandles, identityV2Enabled };
}

describe("identity mode is fixed per poller", () => {
  it("started OFF → keeps names after the switch reads ON; never re-read while polling", async () => {
    let on = false;
    const x = rig(async () => on);
    x.say();
    expect((await x.connect()).ok).toBe(true);
    expect(x.entry().identityV2).toBe(false);
    expect(await x.pollHandles()).toEqual(["Maria Santos"]);   // first poll (initial lane)
    on = true;
    x.say();
    expect(await x.pollHandles()).toEqual(["Maria Santos"]);   // switch now ON — same poller, still names
    expect(x.identityV2Enabled).toHaveBeenCalledTimes(1);      // read once, at Connect
  });
  it("re-Connect to the SAME live keeps the running mode; a NEW live takes the switch as it is", async () => {
    let on = false;
    const x = rig(async () => on);
    await x.connect();
    on = true;
    await x.connect();                                         // same LV1 → stays OFF
    expect(x.entry().identityV2).toBe(false);
    x.live.id = "LV2";
    await x.connect();                                         // new live → reads ON
    expect(x.entry().identityV2).toBe(true);
    x.say();
    expect(await x.pollHandles()).toEqual(["1029384756473829"]);
    on = false;
    await x.connect();                                         // same LV2, switch OFF → stays ON
    expect(x.entry().identityV2).toBe(true);
  });
  it("started ON → ids for the whole session; a switch read error = OFF", async () => {
    const x = rig(async () => true);
    x.say(); await x.connect();
    expect(await x.pollHandles()).toEqual(["1029384756473829"]);
    const y = rig(async () => { throw new Error("db down"); });
    y.say(); await y.connect();
    expect(y.entry().identityV2).toBe(false);
    expect(await y.pollHandles()).toEqual(["Maria Santos"]);
  });
  it("no identityV2Enabled dep → OFF (today)", () => {
    const src = readFileSync("server/fbLive.js", "utf8");
    expect(src).toContain("identityV2Enabled = async () => false,");
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync("server.js", "utf8");
  it("a third cached reader for fb_identity_v2 is passed as identityV2Enabled", () => {
    expect(src).toMatch(/const fbIdentityV2Flag = createFbFlagReader\(\{[\s\S]{0,300}\.eq\("key", "fb_identity_v2"\)/);
    expect(src).toMatch(/identityV2Enabled: fbIdentityV2Flag,/);
  });
});
