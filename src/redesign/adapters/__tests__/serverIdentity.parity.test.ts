// Batch E (#13) — PARITY: the shared serverIdentity module must behave EXACTLY
// like all three previous copies (App.tsx:148-155/169-173 — kept, rollback app;
// connect.ts + useLiveFeed.ts — replaced). CONNECTIVITY-CRITICAL: a drift in
// server URL points connect at the wrong host; a drift in sellerIdOf /
// browserSessionId splits the seller across live rooms. The reference
// implementations below are VERBATIM transcriptions of the old copies.
import { describe, it, expect, beforeEach } from "vitest";
import { resolveServer, SERVER, sellerIdOf, browserSessionId } from "../serverIdentity";

// ── Reference 1: App.tsx:169-173 (SERVER) — verbatim, parameterized on inputs ──
function refAppResolve(envUrl: string | undefined, hostname: string | undefined): string {
  const DEFAULT_SERVER =
    hostname !== undefined && ["localhost", "127.0.0.1"].includes(hostname)
      ? "http://localhost:3001"
      : "https://sellerflow-live-server.onrender.com";
  return String(envUrl || DEFAULT_SERVER).replace(/\/$/, "");
}
// ── Reference 2: connect.ts (old local copy) — was byte-identical logic ──
const refConnectResolve = refAppResolve; // (same text; kept as a named alias for the record)

// ── Reference 3: App.tsx:148-155 browserSessionId via LS.get/LS.set (JSON) ──
function refAppBrowserSessionId(): string {
  // LS.get: JSON.parse with "" default on missing/parse-error; LS.set: JSON.stringify
  let existing: string;
  try { const raw = localStorage.getItem("sf_browser_session"); existing = raw ? JSON.parse(raw) : ""; } catch { existing = ""; }
  if (existing) return existing;
  const next = `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem("sf_browser_session", JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
// ── Reference 4: App.tsx:155 sellerIdOf — verbatim ──
const refSellerIdOf = (email: string) => email.trim().toLowerCase();

describe("resolveServer — parity with all three old SERVER copies", () => {
  const CASES: Array<[string | undefined, string | undefined]> = [
    [undefined, "localhost"],                       // local dev
    [undefined, "127.0.0.1"],                       // local dev (IP)
    [undefined, "www.sellerflowlive.com"],          // production web/APK shell
    [undefined, "sellerflow-git-x.vercel.app"],     // preview
    [undefined, undefined],                         // SSR/no window
    ["https://sellerflow-live-server.onrender.com/", "localhost"], // env wins + trailing slash strip
    ["https://custom.example.com", "www.sellerflowlive.com"],
    ["", "localhost"],                              // empty env falls through to default
  ];
  it.each(CASES)("env=%j hostname=%j → same URL as App.tsx/connect.ts/useLiveFeed", (env, host) => {
    expect(resolveServer(env, host)).toBe(refAppResolve(env, host));
    expect(resolveServer(env, host)).toBe(refConnectResolve(env, host));
  });
  it("pins the two absolute outcomes (guards against editing the reference too)", () => {
    expect(resolveServer(undefined, "www.sellerflowlive.com")).toBe("https://sellerflow-live-server.onrender.com");
    expect(resolveServer(undefined, "localhost")).toBe("http://localhost:3001");
  });
  it("module-scope SERVER is exactly resolveServer(env, current hostname)", () => {
    expect(SERVER).toBe(resolveServer(import.meta.env.VITE_SERVER_URL as string | undefined, window.location.hostname));
  });
});

describe("sellerIdOf — parity (live-room key)", () => {
  it.each([" Ann@X.COM ", "seller@sellerflowlive.com", "  A@B.C"])("%j", (email) => {
    expect(sellerIdOf(email)).toBe(refSellerIdOf(email));
  });
});

describe("browserSessionId — same key, same JSON format, same room as the rollback app", () => {
  beforeEach(() => localStorage.clear());
  it("fresh browser: generates sf-<...> and STORES it as JSON under sf_browser_session", () => {
    const id = browserSessionId();
    expect(id).toMatch(/^sf-\d+-[a-z0-9]+$/);
    expect(JSON.parse(localStorage.getItem("sf_browser_session")!)).toBe(id);
    expect(browserSessionId()).toBe(id); // stable across calls
  });
  it("a value written by the App.tsx copy is read back IDENTICALLY (shared live room)", () => {
    const appId = refAppBrowserSessionId(); // App.tsx generates + stores first
    expect(browserSessionId()).toBe(appId);
  });
  it("a value written by the shared module is read back by the App.tsx copy (both directions)", () => {
    const id = browserSessionId();
    expect(refAppBrowserSessionId()).toBe(id);
  });
  it("corrupted (non-JSON) stored value → regenerates, same as every old copy", () => {
    localStorage.setItem("sf_browser_session", "not json {");
    const id = browserSessionId();
    expect(id).toMatch(/^sf-/);
    expect(refAppBrowserSessionId()).toBe(id); // and the regenerated value is shared again
  });
});
