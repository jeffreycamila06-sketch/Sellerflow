// Messenger receipt: NOTHING changes for a seller whose receipts work today.
// The same story is played through main's sender (fixtures/fbReceipt.main.js, a frozen copy) and through
// this branch's, and EVERYTHING each one did is compared, in order: every database call with its
// arguments, every request to Facebook (address, method, headers, body), every log line, every answer
// given to the app, and the rows left in the table.
//   1. switch off / on / broken / never answering: a sent receipt and every refusal other than
//      10/2018300 → the two lists are identical, and the switch is never even read.
//   2. 10/2018300, switch off: identical to main + ONE read of the switch (after the answer was decided).
//   3. 10/2018300, switch on: main's list + the owner read; the send's own calls, answer and row = main's.
//   4. the one intended difference: MANUAL tries after a 10/2018300 failure (the comment is not used up).
//   5. the AUTOMATIC receipt: identical to main in every story, 10/2018300 included (it counts as before).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as branchMod from "../../../../server/fbReceipt.js";
import * as mainMod from "./fixtures/fbReceipt.main.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "555000111", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-11-24T13:30:00Z");
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const BUYER = "24681357902468";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");

type Graph = { status: number; body: unknown } | "throw";
const ok: Graph = { status: 200, body: { message_id: "m_1", recipient_id: BUYER } };
const refuse = (code: number, sub?: number): Graph => ({ status: 400, body: { error: { code, ...(sub === undefined ? {} : { error_subcode: sub }), message: `(#${code}) refused`, type: "OAuthException", fbtrace_id: "T1" } } });
const OWNED = refuse(10, 2018300);
type Switch = "off" | "on" | "throws" | "hangs" | "none";
type Step = "send" | "info" | "auto";
type Story = { name: string; graph: Graph[]; steps?: Step[]; orders?: number; upload?: "fail"; del?: "fail"; page?: "inactive" | "no_messaging"; access?: false; rows?: Record<string, unknown>[]; body?: Record<string, unknown> };

const order = (i: number) => ({ comment_msg_id: `701_${i}`, platform_meta: { page_id: "P1", live_video_id: "LV1", commenter_id: BUYER }, handle: "Buyer", created_at: `2026-11-24T12:0${i}:00Z` });
const shown = (v: unknown): unknown => Buffer.isBuffer(v) || v instanceof Uint8Array ? `bytes:${createHash("sha256").update(v as Uint8Array).digest("hex").slice(0, 16)}:${(v as Uint8Array).length}` : v;

type Api = {
  send(u: string, b: unknown): Promise<unknown>; info(u: string, b: unknown): Promise<unknown>;
  autoSend(u: string, t: unknown, makePng: () => Promise<Buffer>, preflight: () => Promise<boolean>): Promise<unknown>;
  _ownerReadDone?: () => Promise<unknown>;
};
type Sender = { createFbReceipt: (deps: never) => unknown };

async function play(mod: Sender, story: Story, sw: Switch) {
  const did: string[] = [];
  const rows: Record<string, unknown>[] = (story.rows || []).map((r, i) => ({ id: 1 + i, user_id: U, ...r }));
  const graph = [...story.graph];
  const real: Record<string, (...a: never[]) => unknown> = {
    hasReceiptAccess: async () => story.access !== false,
    listReceiptOrders: async () => Array.from({ length: story.orders ?? 1 }, (_, i) => order(i + 1)),
    listReceiptRows: async (ids: string[]) => rows.filter((r) => ids.includes(String(r.comment_id))).map((r) => ({ ...r })),
    insertReceipt: async (row: Record<string, unknown>) => {
      if (rows.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { ...row, id: 100 + rows.length }; rows.push(r); return { id: r.id };
    },
    updateReceipt: async (id: number, patch: Record<string, unknown>) => { Object.assign(rows.find((r) => r.id === id)!, patch); return {}; },
    deleteReceipt: async (id: number) => { if (story.del === "fail") return false; const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true; },
    uploadReceiptImage: async (path: string) => { if (story.upload === "fail") throw new Error("storage down"); return `https://cdn.test/storage/v1/object/public/fb-receipts/${path}`; },
    getPage: async () => ({ user_id: U, page_id: "P1", active: story.page !== "inactive", can_message: story.page !== "no_messaging", access_token: encryptToken("PAGE-TOKEN", CONFIG.tokenKey) }),
    setActive: async () => ({}),
    ...(sw === "none" ? {} : {
      ownerReadEnabled: async () => {
        if (sw === "throws") throw new Error("settings read failed");
        if (sw === "hangs") return new Promise(() => {});
        return sw === "on";
      },
    }),
  };
  // every database call is written down, whatever its name (a call to a method the store does not have is written down too)
  const store = new Proxy(real, {
    get(target, name: string) {
      if (typeof name !== "string" || name === "then") return undefined;
      if (!(name in target)) return undefined;
      return async (...args: unknown[]) => { did.push(`db ${name}(${JSON.stringify(args.map(shown))})`); return (target[name] as (...a: unknown[]) => unknown)(...args); };
    },
    has: (target, name) => name in target,
  });
  const fetchImpl = async (url: string, init?: { method?: string; headers?: unknown; body?: unknown }) => {
    const method = String(init?.method || "GET");
    did.push(`facebook ${method} ${url} headers=${JSON.stringify(init?.headers ?? null)} body=${String(init?.body ?? "")}`);
    if (method !== "POST") return { status: 200, json: async () => ({ data: [{ thread_owner: { app_id: "263902037430900" }, updated_time: "2026-11-24T13:18:00+0000" }] }) };
    const g = graph.shift() ?? ok;
    if (g === "throw") throw new Error("socket hang up");
    return { status: g.status, json: async () => g.body };
  };
  let n = 0;
  const api = (mod.createFbReceipt as unknown as (deps: unknown) => Api)({ config: CONFIG, store, fetchImpl, now: () => NOW, log: (l: string) => did.push(`log ${l}`), randomHex: () => String(++n).padStart(64, "0") });
  const answers: unknown[] = [];
  for (const step of story.steps || ["send"]) {
    const body = story.body ?? { sessionId: S, buyerNumber: 3, imagePngBase64: PNG_B64 };
    const a = step === "send" ? await api.send(U, body)
      : step === "auto" ? await api.autoSend(U, { sessionId: S, buyerNumber: 3 }, async () => Buffer.from(PNG_B64, "base64"), async () => true)
      : await api.info(U, body);
    answers.push(a);
    did.push(`answer ${JSON.stringify(a)}`);
    // main has no owner read to wait for; the branch's (if any) is let finish before the next step,
    // except when the switch read never answers (then nothing may be waiting on it)
    const done = api._ownerReadDone;
    if (done && sw !== "hangs") await done();
  }
  return { did, answers, rows: JSON.stringify(rows) };
}

// what belongs to the owner read (never present on main)
const isOwnerRead = (l: string) => l.startsWith("db ownerReadEnabled(") || l.startsWith("facebook GET ") || l.startsWith("log [FB] receipt owner ")
  || /^db updateReceipt\(\[\d+,\{"error_detail":"[^"]*\| owner=/.test(l);

const WORKING: Story[] = [
  { name: "a receipt is sent", graph: [ok] },
  { name: "sent, then the sheet is opened again, then a second receipt on the buyer's other comment", graph: [ok, ok], steps: ["send", "info", "send", "info"], orders: 2 },
  { name: "three comments, three receipts, then none left", graph: [ok, ok, ok], steps: ["send", "send", "send", "send", "info"], orders: 3 },
  { name: "info only", graph: [], steps: ["info"] },
  { name: "refused 100/1893060 twice → comment used up", graph: [refuse(100, 1893060), refuse(100, 1893060)], steps: ["send", "send", "send", "info"] },
  { name: "refused 10 with no subcode", graph: [refuse(10), refuse(10)], steps: ["send", "send", "send"] },
  { name: "refused 10/2018301 (a neighbour code)", graph: [refuse(10, 2018301), refuse(10, 2018301)], steps: ["send", "send", "send"] },
  { name: "refused 10903/2018300 (same subcode, other code)", graph: [refuse(10903, 2018300), refuse(10903, 2018300)], steps: ["send", "send", "send"] },
  { name: "refused 10903/2018278 (no private reply)", graph: [refuse(10903, 2018278)], steps: ["send", "info"] },
  { name: "refused 551, then sent on the second try", graph: [refuse(551, 1545041), ok], steps: ["send", "send", "info"] },
  { name: "refused, then sent on the buyer's other comment", graph: [refuse(100, 2018278), ok], steps: ["send", "send"], orders: 2 },
  { name: "rate limit 613 → comment given back, then sent", graph: [refuse(613), ok], steps: ["send", "send"] },
  { name: "token 190 → needs re-authorize", graph: [refuse(190, 460)], steps: ["send", "info"] },
  { name: "codes 1, 2, 4, 17, 32, 80001, 80006 → try later", graph: [1, 2, 4, 17, 32, 80001, 80006].map((c) => refuse(c)), steps: Array(7).fill("send") },
  { name: "613 and the claim cannot be deleted", graph: [refuse(613)], del: "fail", steps: ["send", "info"] },
  { name: "no answer from Facebook (delivery unknown)", graph: ["throw"], steps: ["send", "send", "info"] },
  { name: "Facebook answers 200 without a message id", graph: [{ status: 200, body: {} }], steps: ["send", "info"] },
  { name: "Facebook answers 500 with no body", graph: [{ status: 500, body: null }], steps: ["send", "info"] },
  { name: "the picture cannot be stored", graph: [], upload: "fail", steps: ["send", "send", "info"] },
  { name: "the picture cannot be stored and the claim cannot be deleted", graph: [], upload: "fail", del: "fail", steps: ["send", "send", "send"] },
  { name: "the Page is not connected", graph: [], page: "inactive" },
  { name: "the Page has no messaging permission", graph: [], page: "no_messaging" },
  { name: "the seller has no receipt access", graph: [], access: false, steps: ["send", "info"] },
  { name: "no orders", graph: [], orders: 0, steps: ["send", "info"] },
  { name: "bad picture", graph: [], body: { sessionId: S, buyerNumber: 3, imagePngBase64: "AAAA" } },
  { name: "bad request", graph: [], body: { sessionId: "x", buyerNumber: 3, imagePngBase64: PNG_B64 } },
  { name: "a comment already sent before", graph: [], rows: [{ comment_id: "701_1", status: "sent", sent_at: "2026-11-24T12:30:00Z" }], steps: ["info", "send"] },
  { name: "two old failures of another kind on the comment", graph: [], rows: [{ comment_id: "701_1", status: "failed", error_code: "100/1893060" }, { comment_id: "701_1", status: "failed", error_code: "upload/0" }], steps: ["info", "send"] },
  { name: "old failures with no code", graph: [ok], rows: [{ comment_id: "701_1", status: "failed" }, { comment_id: "701_2", status: "failed", error_code: null }], orders: 2, steps: ["info", "send", "info"] },
];

describe("1. a seller whose receipts work today: same calls, same answers as main — whatever the switch says", () => {
  for (const sw of ["off", "on", "throws", "hangs", "none"] as Switch[]) {
    it(`switch ${sw}: ${WORKING.length} stories, everything done is identical to main and the switch is never read`, async () => {
      for (const story of WORKING) {
        const a = await play(mainMod, story, sw), b = await play(branchMod, story, sw);
        expect(b.did, story.name).toEqual(a.did);
        expect(b.answers, story.name).toEqual(a.answers);
        expect(b.rows, story.name).toBe(a.rows);
        expect(b.did.filter(isOwnerRead), story.name).toEqual([]);
        expect(a.did.length, story.name).toBeGreaterThan(0);
      }
    });
  }
  it("the stories really cover what they say: sent, used up, given back, unknown, upload, access, page", async () => {
    const all = (await Promise.all(WORKING.map((s) => play(branchMod, s, "on")))).flatMap((r) => r.answers.map((x) => JSON.stringify(x))).join("\n");
    for (const word of ['"ok":true,"sentCount":1', '"sentCount":3', "none_left", "send_failed", "try_later", "needs_reauth", "unknown_result", "upload_failed", "needs_messaging", "no_access", "bad_image", "bad_request", "10903/2018300", "10/2018301", "10/0"]) expect(all, word).toContain(word);
  });
});

describe("2. refused 10/2018300 with the switch off (as created), missing, broken or never answering: main + one read of the switch", () => {
  const story: Story = { name: "refused 10/2018300", graph: [OWNED], steps: ["send"] };
  for (const sw of ["off", "throws", "hangs"] as Switch[]) {
    it(`switch ${sw}: no request to Facebook beyond main's; the answer and the row are main's`, async () => {
      const a = await play(mainMod, story, sw), b = await play(branchMod, story, sw);
      expect(b.did.filter((l) => !isOwnerRead(l))).toEqual(a.did);
      expect(b.did.filter(isOwnerRead)).toEqual(["db ownerReadEnabled([])"]);
      expect(b.did.indexOf("db ownerReadEnabled([])")).toBeGreaterThan(b.did.findIndex((l) => l.startsWith("log [FB] receipt user="))); // after the failed row was written and logged
      expect(b.answers).toEqual(a.answers);
      expect(b.rows).toBe(a.rows);
      expect(b.did.filter((l) => l.startsWith("facebook "))).toHaveLength(1);
    });
  }
  it("a server whose store has no switch reader at all (older wiring): identical to main, nothing extra", async () => {
    const a = await play(mainMod, story, "none"), b = await play(branchMod, story, "none");
    expect(b.did).toEqual(a.did);
    expect(b.rows).toBe(a.rows);
  });
});

describe("3. refused 10/2018300 with the switch on: main's calls + the owner read, which changes nothing of the send", () => {
  it("the send's own calls, its answer and its row are main's; the read comes after them", async () => {
    const story: Story = { name: "refused 10/2018300", graph: [OWNED], steps: ["send"] };
    const a = await play(mainMod, story, "on"), b = await play(branchMod, story, "on");
    expect(b.did.filter((l) => !isOwnerRead(l))).toEqual(a.did);
    expect(b.answers).toEqual(a.answers);
    const extra = b.did.filter(isOwnerRead);
    expect(extra.map((l) => l.split(/[ (]/).slice(0, 2).join(" "))).toEqual(["db ownerReadEnabled", "facebook GET", "facebook GET", "log [FB]", "db updateReceipt"]);
    // the row: main's, plus the note added to its error text — status, code and picture untouched
    const [ra] = JSON.parse(a.rows), [rb] = JSON.parse(b.rows);
    expect(String(rb.error_detail).startsWith(`${ra.error_detail} | owner=`)).toBe(true);
    expect({ ...rb, error_detail: ra.error_detail }).toEqual(ra);
    // everything of the read happens after the last thing main does before answering
    const lastOfMain = b.did.lastIndexOf(a.did[a.did.length - 2]);
    expect(b.did.findIndex(isOwnerRead)).toBeGreaterThan(lastOfMain);
  });
});

describe("4. the one intended difference: after a 10/2018300 refusal the comment is not used up", () => {
  it("two such refusals then a third try: main says none_left, the branch tries again — and that is the ONLY difference", async () => {
    const story: Story = { name: "three tries", graph: [OWNED, OWNED, ok], steps: ["send", "send", "send"] };
    const a = await play(mainMod, story, "off"), b = await play(branchMod, story, "off");
    expect(b.answers.slice(0, 2)).toEqual(a.answers.slice(0, 2));
    expect((a.answers[2] as { json: { error: string } }).json.error).toBe("none_left");
    expect((b.answers[2] as { json: { ok: boolean } }).json.ok).toBe(true);
    const cut = (did: string[]) => did.slice(0, did.findIndex((l, i) => l.startsWith("answer ") && did.slice(0, i + 1).filter((x) => x.startsWith("answer ")).length === 2) + 1);
    expect(cut(b.did).filter((l) => !isOwnerRead(l))).toEqual(cut(a.did)); // the first two tries: identical
  });
  it("a 10/2018300 row next to a real failure: the real one still counts exactly as on main", async () => {
    const story: Story = { name: "mixed", graph: [refuse(100, 1893060), OWNED, refuse(100, 1893060)], steps: ["send", "send", "send", "send", "info"] };
    const b = await play(branchMod, story, "off");
    expect(b.answers.map((x) => (x as { json: { error?: string; reason?: string } }).json.error ?? (x as { json: { reason?: string } }).json.reason)).toEqual(["send_failed", "send_failed", "send_failed", "none_left", "none_left"]);
  });
});

describe("5. the automatic receipt keeps main's counting — a buyer refused with 10/2018300 is given up after two tries, as before", () => {
  const AUTO: Story[] = [
    { name: "auto: sent", graph: [ok], steps: ["auto", "auto"] },
    { name: "auto: refused 10/2018300 again and again", graph: [OWNED, OWNED, OWNED, OWNED], steps: ["auto", "auto", "auto", "auto", "auto"] },
    { name: "auto: refused 10/2018300 on two comments", graph: [OWNED, OWNED, OWNED, OWNED, OWNED], steps: ["auto", "auto", "auto", "auto", "auto", "auto"], orders: 2 },
    { name: "auto: 10/2018300 then sent", graph: [OWNED, ok], steps: ["auto", "auto", "auto"] },
    { name: "auto: two old 10/2018300 rows from manual tries", graph: [ok], rows: [{ comment_id: "701_1", status: "failed", error_code: "10/2018300" }, { comment_id: "701_1", status: "failed", error_code: "10/2018300" }], steps: ["auto"] },
    { name: "auto: refused 100/1893060 twice", graph: [refuse(100, 1893060), refuse(100, 1893060)], steps: ["auto", "auto", "auto"] },
    { name: "auto: rate limit 613, then sent", graph: [refuse(613), ok], steps: ["auto", "auto"] },
    { name: "auto: no answer from Facebook", graph: ["throw"], steps: ["auto", "auto"] },
    { name: "auto: the picture cannot be stored", graph: [], upload: "fail", steps: ["auto", "auto"] },
    { name: "auto: no orders", graph: [], orders: 0, steps: ["auto"] },
    { name: "auto after a manual 10/2018300 refusal, then manual again", graph: [OWNED, OWNED, OWNED], steps: ["send", "auto", "auto"] },
  ];
  for (const sw of ["off", "on", "throws", "none"] as Switch[]) {
    it(`switch ${sw}: ${AUTO.length} stories — every database call, request, log line, answer and row is main's (owner-read lines aside)`, async () => {
      for (const story of AUTO) {
        const a = await play(mainMod, story, sw), b = await play(branchMod, story, sw);
        expect(b.did.filter((l) => !isOwnerRead(l)), story.name).toEqual(a.did);
        expect(b.answers, story.name).toEqual(a.answers);
        const strip = (rows: string) => JSON.stringify((JSON.parse(rows) as Record<string, unknown>[]).map((r) => ({ ...r, error_detail: String(r.error_detail ?? "").split(" | owner=")[0] || r.error_detail })));
        expect(strip(b.rows), story.name).toBe(strip(a.rows));
        if (sw !== "on") expect(b.did.filter((l) => isOwnerRead(l) && !l.startsWith("db ownerReadEnabled(")), story.name).toEqual([]);
      }
    });
  }
  it("the stories include the case that matters: after two 10/2018300 refusals the automatic receipt stops trying that buyer", async () => {
    const b = await play(branchMod, AUTO[1], "off");
    expect(b.answers.map((x) => JSON.stringify((x as { json: unknown }).json))).toEqual([
      '{"ok":false,"error":"send_failed","code":10,"fb_code":"10/2018300"}', '{"ok":false,"error":"send_failed","code":10,"fb_code":"10/2018300"}',
      '{"ok":false,"skipped":"none_left"}', '{"ok":false,"skipped":"none_left"}', '{"ok":false,"skipped":"none_left"}',
    ]);
    expect(b.did.filter((l) => l.startsWith("facebook POST"))).toHaveLength(2);
  });
  it("pickReceiptCandidates: countEveryFail = main's rule exactly, for any mix of rows", () => {
    const orders = [order(1), order(2), order(3)];
    const codes = ["10/2018300", "100/1893060", "upload/0", null, "10/0"];
    let seed = 7; const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let i = 0; i < 400; i++) {
      const rows = Array.from({ length: rnd(7) }, () => ({ user_id: U, comment_id: `701_${1 + rnd(3)}`, status: ["failed", "failed", "failed", "sent", "pending"][rnd(5)], error_code: codes[rnd(codes.length)] }));
      expect(branchMod.pickReceiptCandidates(orders, rows, { countEveryFail: true }), JSON.stringify(rows)).toEqual(mainMod.pickReceiptCandidates(orders, rows));
      // and without it, the only rows that make a difference are failed 10/2018300 rows
      const without = rows.filter((r) => !(r.status === "failed" && r.error_code === "10/2018300"));
      expect(branchMod.pickReceiptCandidates(orders, rows), JSON.stringify(rows)).toEqual(mainMod.pickReceiptCandidates(orders, without));
    }
  });
});
