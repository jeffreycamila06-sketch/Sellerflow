// Build 12 (Fix B, robot finding): which sentence a failed TikTok connect shows, for exactly
// what the live server sends back — on the new app (opaque codes, ?sfl_codes=1, encoded by the
// server's own table) and on the old word path.
//
// Finding (no server change, per the build rule): the server does NOT tell "username not found"
// apart today. With a made-up name the room lookup fails and the connect library (pinned
// 2.1.1-beta1) throws FetchIsLiveError, whose message is EMPTY — the server answers 500 with
// error "" (old path) / "E0" (codes). Same answer as any other failed room lookup → generic.
// "Exists but not live" IS clear when the server says so (409 + notLive, sent by its own is-live
// checks) → the app's existing not-live sentence. The library's other offline text
// ("The requested user isn't online :(", 500) reaches the new app only as "E0", like any
// unknown error → generic on both paths (the app cannot tell it apart without a server change).
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { connectPlatform, connectFailText } from "../connect";
import { encodeErr } from "../../../../server/errorCodes.js";
import { buildT } from "../../i18n";

const require = createRequire(import.meta.url);
const libErrors = require("tiktok-live-connector/dist/types/errors.js") as {
  FetchIsLiveError: new (errors: Error[], msg: string) => Error;
  UserOfflineError: new (msg: string) => Error;
};

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// What connectTikTok answers (server.js catch), then what the codes layer turns it into.
type Answer = { status: number; body: Record<string, unknown> };
const asServerSends = (a: Answer, codes: boolean): Answer =>
  codes ? { status: a.status, body: { ...a.body, error: encodeErr(a.body.error as string) } } : a;
const serve = ({ status, body }: Answer) => {
  globalThis.fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body })) as unknown as typeof fetch;
};
async function sentence(a: Answer, codes: boolean, lang = "en"): Promise<string> {
  serve(asServerSends(a, codes));
  const r = await connectPlatform("TikTok", { username: "sfl_robot_x7q9z_notlive" }, "s@x.com");
  expect(r.ok).toBe(false);
  return connectFailText(r, buildT(lang));
}

// The server's answers, built from the real library errors where the library is the source.
const NOT_LIVE: Answer = { status: 409, body: { success: false, notLive: true, error: "Account is not live right now. Start your TikTok LIVE first." } };
const NOT_FOUND: Answer = { status: 500, body: { success: false, error: new libErrors.FetchIsLiveError([new Error("x")], "Failed to retrieve Room ID from all sources.").message } };
const LIB_OFFLINE: Answer = { status: 500, body: { success: false, error: new libErrors.UserOfflineError("The requested user isn't online :(").message } };
const OTHER_FAIL: Answer = { status: 500, body: { success: false, error: "Missing cursor in initial fetch response." } };

describe.each([["new app (codes)", true], ["old word path", false]])("TikTok connect failure sentence — %s", (_n, codes) => {
  it("exists but not live (server says notLive) → the existing not-live sentence", async () => {
    for (const lang of LANGS) expect(await sentence(NOT_LIVE, codes, lang)).toBe(buildT(lang).rd_cm_not_live);
  });

  it("made-up / not-found name → the server sends no reason → the generic sentence", async () => {
    expect(NOT_FOUND.body.error).toBe(""); // the pinned library drops the reason
    for (const lang of LANGS) expect(await sentence(NOT_FOUND, codes, lang)).toBe(buildT(lang).rd_cm_conn_try_again);
  });

  it("the library's 'isn't online' text → generic (the new app only sees E0, same as any error)", async () => {
    if (codes) expect(encodeErr(LIB_OFFLINE.body.error as string)).toBe("E0");
    expect(await sentence(LIB_OFFLINE, codes)).toBe(buildT("en").rd_cm_conn_try_again);
  });

  it("ambiguous (fail-open, then the connect fails some other way) → generic", async () => {
    expect(await sentence(OTHER_FAIL, codes)).toBe(buildT("en").rd_cm_conn_try_again);
  });

  it("no case ever shows an E<number> code", async () => {
    for (const a of [NOT_LIVE, NOT_FOUND, LIB_OFFLINE, OTHER_FAIL]) {
      for (const lang of LANGS) expect(await sentence(a, codes, lang)).not.toMatch(/E\d+/);
    }
  });
});
