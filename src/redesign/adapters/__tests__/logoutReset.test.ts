import { describe, it, expect, vi, afterEach } from "vitest";
import { signOutAndReload, sessionEnded, reloadTarget, appReload, SIGN_OUT_TIMEOUT_MS } from "../logoutReset";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("signOutAndReload", () => {
  it("awaits the sign-out, THEN reloads", async () => {
    const order: string[] = [];
    vi.spyOn(appReload, "run").mockImplementation(() => { order.push("reload"); });
    await signOutAndReload(async () => { await Promise.resolve(); order.push("signOut"); });
    expect(order).toEqual(["signOut", "reload"]);
  });
  it("a failing sign-out still reloads", async () => {
    const run = vi.spyOn(appReload, "run").mockImplementation(() => {});
    await signOutAndReload(async () => { throw new Error("offline"); });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("a hanging sign-out reloads after the timeout", async () => {
    vi.useFakeTimers();
    const run = vi.spyOn(appReload, "run").mockImplementation(() => {});
    const p = signOutAndReload(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("sessionEnded = authed → anon only", () => {
    expect(sessionEnded("authed", "anon")).toBe(true);
    expect(sessionEnded(null, "anon")).toBe(false);
    expect(sessionEnded("loading", "anon")).toBe(false);
    expect(sessionEnded("authed", "authed")).toBe(false);
    expect(sessionEnded("anon", "authed")).toBe(false);
  });
  it("reload target keeps the page + query (phone shells carry ?apk / ?ios), drops the hash", () => {
    expect(reloadTarget({ pathname: "/", search: "?apk=20260523-dark-mobile" })).toBe("/?apk=20260523-dark-mobile");
    expect(reloadTarget({ pathname: "", search: "" })).toBe("/");
  });
});
