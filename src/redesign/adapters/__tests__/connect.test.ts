// Connect — parity tests for the pure helpers + connectPlatform POST (App.tsx
// 159/256/259/262/276 + 4269-4296). fetch + supabase are stubbed.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  cleanLiveAccount, maxAcc, accountList, accountText, registeredAccountCount, canConnectMore,
  registeredAccountsFor, appendAccount, connectPlatform, accountSlots, keepLockedAccounts, fitProfileAccounts,
  composeChannelSave, connectToast,
} from "../connect";
import type { AccountUser } from "../../../accountDb";

const user = (over: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: "a", email: "s@x.com",
  profile: { fullName: "S", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller", ...over,
});

describe("pure helpers — verbatim from App.tsx", () => {
  it("cleanLiveAccount strips @ + lowercases", () => {
    expect(cleanLiveAccount(" @Duong_Lily ")).toBe("duong_lily");
    expect(cleanLiveAccount("")).toBe("");
  });
  it("maxAcc per plan (free/trial/basic=1, pro=3, master=5)", () => {
    expect(maxAcc("free")).toBe(1); expect(maxAcc("basic")).toBe(1);
    expect(maxAcc("plus")).toBe(2);
    expect(maxAcc("pro")).toBe(3); expect(maxAcc("master")).toBe(5);
    expect(maxAcc("???")).toBe(1);
  });
  it("accountList splits comma/newline, trims, dedups; accountText rejoins", () => {
    expect(accountList("a, b\nc,a")).toEqual(["a", "b", "c"]);
    expect(accountText([" a ", "", "b"])).toBe("a\nb");
  });
  it("registeredAccountCount sums tiktok + facebook", () => {
    expect(registeredAccountCount(user({ profile: { ...user().profile, tiktok: "a,b", facebook: "c" } }))).toBe(3);
  });
  it("canConnectMore: under limit OR admin", () => {
    expect(canConnectMore(user({ plan: "basic", profile: { ...user().profile, tiktok: "a" } }))).toBe(false); // 1/1
    expect(canConnectMore(user({ plan: "pro", profile: { ...user().profile, tiktok: "a" } }))).toBe(true);    // 1/3
    expect(canConnectMore(user({ plan: "basic", role: "admin", profile: { ...user().profile, tiktok: "a" } }))).toBe(true); // admin bypass
  });
  it("registeredAccountsFor caps to the plan limit", () => {
    const u = user({ plan: "pro", profile: { ...user().profile, tiktok: "a,b,c,d,e" } });
    expect(registeredAccountsFor(u, "TikTok")).toEqual(["a", "b", "c"]); // pro=3
  });
});

describe("accountSlots / keepLockedAccounts / fitProfileAccounts — verbatim App.tsx 261-273", () => {
  it("accountSlots caps to limit + pads empties to a fixed length", () => {
    expect(accountSlots("a,b,c", 1)).toEqual(["a"]);                         // basic = 1 box
    expect(accountSlots("a", 3)).toEqual(["a", "", ""]);                     // pro = 1 filled + 2 empty
    expect(accountSlots("", 2)).toEqual(["", ""]);                          // all empty
    expect(accountSlots("a,b,c,d,e,f", 5)).toEqual(["a", "b", "c", "d", "e"]); // master cap
  });
  it("keepLockedAccounts: saved slot wins; empty slot accepts the edit", () => {
    expect(keepLockedAccounts("a", "x\nb", 3)).toBe("a\nb");  // index0 "a" locked (edit "x" ignored); index1 "b" accepted
    expect(keepLockedAccounts("", "b", 3)).toBe("b");          // nothing locked → edit accepted
  });
  it("fitProfileAccounts enforces the COMBINED tiktok+facebook cap (locked first)", () => {
    // pro limit 3: locked a + edits b,c (tt) fills the cap → fb d (4th) dropped
    const out = fitProfileAccounts({ tiktok: "a", facebook: "" }, { tiktok: "a\nb\nc", facebook: "d" }, 3);
    expect(accountList(out.tiktok)).toEqual(["a", "b", "c"]);
    expect(accountList(out.facebook)).toEqual([]);
  });
  it("fitProfileAccounts splits remaining room across platforms", () => {
    const out = fitProfileAccounts({ tiktok: "", facebook: "" }, { tiktok: "a", facebook: "b\nc" }, 3);
    expect(accountList(out.tiktok)).toEqual(["a"]);
    expect(accountList(out.facebook)).toEqual(["b", "c"]);     // 1 + 2 = 3
  });
});

describe("composeChannelSave — Channels save compose (App.tsx handleSaveProfile 4230-4238)", () => {
  it("locked-wins: a saved account can't be overwritten or wiped by the edit", () => {
    // pro=3, tiktok 'a' saved (locked slot0). Edit changes slot0→'x' and adds 'b'.
    const out = composeChannelSave({ tiktok: "a", facebook: "" }, { tiktok: "x\nb", facebook: "" }, 3, false);
    expect(accountList(out.tiktok)).toEqual(["a", "b"]); // 'a' kept, 'x' ignored, 'b' added
  });
  it("locked account survives even when the edit clears the slot", () => {
    const out = composeChannelSave({ tiktok: "a", facebook: "" }, { tiktok: "", facebook: "" }, 3, false);
    expect(accountList(out.tiktok)).toEqual(["a"]); // can't wipe a server-known account
  });
  it("combined cap across tiktok+facebook (4th dropped)", () => {
    const out = composeChannelSave({ tiktok: "a", facebook: "" }, { tiktok: "a\nb\nc", facebook: "d" }, 3, false);
    expect(accountList(out.tiktok)).toEqual(["a", "b", "c"]);
    expect(accountList(out.facebook)).toEqual([]);
  });
  it("admin bypass: saves the edited lists verbatim (no lock / no cap)", () => {
    const out = composeChannelSave({ tiktok: "a", facebook: "" }, { tiktok: "x\nb\nc\nd\ne\nf", facebook: "g" }, 3, true);
    expect(out.tiktok).toBe("x\nb\nc\nd\ne\nf");
    expect(out.facebook).toBe("g");
  });
});

describe("connectToast — honest success/error toast for the chip connect", () => {
  it("ok → success toast with the given message", () => {
    expect(connectToast({ ok: true }, "Connected!", "Connection failed.")).toEqual({ msg: "Connected!", kind: "ok" });
  });
  it("failure → error toast passing the real reason through verbatim", () => {
    expect(connectToast({ ok: false, error: "Can't reach the live server. Check your connection." }, "Connected!", "Connection failed."))
      .toEqual({ msg: "Can't reach the live server. Check your connection.", kind: "err" });
  });
  it("failure with empty error → generic fallback", () => {
    expect(connectToast({ ok: false, error: "" }, "Connected!", "Connection failed.")).toEqual({ msg: "Connection failed.", kind: "err" });
    expect(connectToast({ ok: false }, "Connected!", "Connection failed.")).toEqual({ msg: "Connection failed.", kind: "err" });
  });
});

describe("appendAccount — registers a new account if room (App.tsx 4304-4307)", () => {
  it("adds to the platform field + marks connected", () => {
    const u = user({ plan: "pro", profile: { ...user().profile, tiktok: "a" } });
    const next = appendAccount(u, "TikTok", "b")!;
    expect(accountList(next.profile.tiktok)).toEqual(["a", "b"]);
    expect(next.connectedAccounts).toContain("TikTok");
  });
  it("returns null when already present or over the limit", () => {
    expect(appendAccount(user({ profile: { ...user().profile, tiktok: "a" } }), "TikTok", "a")).toBeNull();
    expect(appendAccount(user({ plan: "basic", profile: { ...user().profile, tiktok: "a" } }), "TikTok", "b")).toBeNull(); // 1/1 full
  });
});

describe("connectPlatform — POST to the live server", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  const okResp = (body: unknown, status = 200) => Promise.resolve({ status, statusText: "OK", json: () => Promise.resolve(body) } as Response);

  it("TikTok: posts cleaned username + meta; success returns the account", async () => {
    fetchMock.mockReturnValue(okResp({ success: true }));
    const r = await connectPlatform("TikTok", { username: "@Duong_Lily" }, "Seller@X.com");
    expect(r.ok).toBe(true); expect(r.account).toBe("duong_lily");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/connect\/tiktok$/);
    const sent = JSON.parse((opts as RequestInit).body as string);
    expect(sent.username).toBe("duong_lily");
    expect(sent.sellerId).toBe("seller@x.com");
    expect(typeof sent.sessionId).toBe("string");
  });
  it("Facebook: posts page/liveVideoId/accessToken", async () => {
    fetchMock.mockReturnValue(okResp({ success: true }));
    const r = await connectPlatform("Facebook", { liveVideoId: "VID123", accessToken: "TOK" }, "s@x.com");
    expect(r.ok).toBe(true); expect(r.account).toBe("VID123");
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent).toMatchObject({ username: "VID123", pageName: "VID123", liveVideoId: "VID123", accessToken: "TOK" });
  });
  it("maps 401 / 500 / !success / network to ok:false + error", async () => {
    fetchMock.mockReturnValueOnce(okResp({ error: "no" }, 401));
    expect((await connectPlatform("TikTok", { username: "a" }, "s@x.com"))).toMatchObject({ ok: false, error: "no" });
    fetchMock.mockReturnValueOnce(okResp({ success: false, error: "bad" }, 200));
    expect((await connectPlatform("TikTok", { username: "a" }, "s@x.com"))).toMatchObject({ ok: false, error: "bad" });
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("down")));
    expect((await connectPlatform("TikTok", { username: "a" }, "s@x.com")).ok).toBe(false);
  });
  it("maps 409 notLive → ok:false + notLive:true + the server message (distinct from a server error)", async () => {
    fetchMock.mockReturnValueOnce(okResp({ success: false, notLive: true, error: "Account is not live right now. Start your TikTok LIVE first." }, 409));
    const r = await connectPlatform("TikTok", { username: "a" }, "s@x.com");
    expect(r).toMatchObject({ ok: false, notLive: true, error: "Account is not live right now. Start your TikTok LIVE first." });
  });
  it("does NOT set notLive when 409 lacks the flag (treated as a generic failure)", async () => {
    fetchMock.mockReturnValueOnce(okResp({ success: false, error: "conflict" }, 409));
    const r = await connectPlatform("TikTok", { username: "a" }, "s@x.com");
    expect(r.ok).toBe(false);
    expect(r.notLive).toBeUndefined();
  });
});
