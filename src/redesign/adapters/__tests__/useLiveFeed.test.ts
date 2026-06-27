// Phase 5d — PARITY test for the live-feed adapter's commentKey + the
// production→redesign comment mapper. No Supabase / socket / React involved.
import { describe, it, expect, afterEach, vi } from "vitest";
import { commentKey, toRedesignComment, isPreviewEnv } from "../useLiveFeed";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

// referenceCommentKey is COPIED VERBATIM from src/App.tsx:111-114. The adapter's
// commentKey MUST equal this byte-for-byte. If App.tsx changes the formula, update
// BOTH this reference and the adapter together — this test is the guard.
const referenceCommentKey = (c: ProdComment | null | undefined): string => {
  if (!c) return "missing-comment";
  return `${c.platform || "TikTok"}|${c.sourceUsername || ""}|${c.sessionId || ""}|${c.handle || "buyer"}|${c.timestamp || c.time || ""}|${c.comment || ""}`;
};

const mk = (over: Partial<ProdComment> = {}): ProdComment => ({
  handle: "ann", name: "Ann", comment: "mine red lipstick", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-06-26T13:41:00.000Z", sourceUsername: "shop_tt", sessionId: "sf-1",
  ...over,
});

describe("commentKey — parity with App.tsx:111-114", () => {
  const cases: (Partial<ProdComment> | null)[] = [
    {},
    { platform: "Facebook" },
    { sourceUsername: "", sessionId: "" },
    { handle: "", timestamp: "", time: "" },        // falls back to "buyer" + ""
    { timestamp: "", time: "9:00:00 PM" },           // time fallback when no timestamp
    { comment: "" },
    { handle: "Iñtërnâtiônàlizætiøn", comment: "café ☕ 中文" }, // unicode
    null,
  ];
  it("matches the reference for every case byte-for-byte", () => {
    for (const c of cases) {
      const input = c === null ? null : mk(c);
      expect(commentKey(input)).toBe(referenceCommentKey(input));
    }
  });
  it("pins the exact format (golden)", () => {
    expect(commentKey(mk())).toBe("TikTok|shop_tt|sf-1|ann|2026-06-26T13:41:00.000Z|mine red lipstick");
    expect(commentKey(null)).toBe("missing-comment");
    expect(commentKey(mk({ platform: "Facebook", sourceUsername: "", sessionId: "", handle: "", timestamp: "", time: "" })))
      .toBe("Facebook|||buyer||mine red lipstick");
  });
  it("dedups identical comments (same key) but separates differing ones", () => {
    expect(commentKey(mk())).toBe(commentKey(mk()));
    expect(commentKey(mk())).not.toBe(commentKey(mk({ comment: "different" })));
    expect(commentKey(mk())).not.toBe(commentKey(mk({ timestamp: "2026-06-26T13:42:00.000Z" })));
  });
});

describe("toRedesignComment", () => {
  it("maps to the Dashboard comment shape with @-handle + key id", () => {
    const r = toRedesignComment(mk());
    expect(r.id).toBe(commentKey(mk()));
    expect(r.name).toBe("Ann");
    expect(r.handle).toBe("@ann");      // @ added
    expect(r.text).toBe("mine red lipstick");
    expect(r.mine).toBe(true);
    expect(r.time).toBe("9:41:00 PM");
  });
  it("keeps an existing @ and falls back name→handle", () => {
    const r = toRedesignComment(mk({ handle: "@kept", name: "" }));
    expect(r.handle).toBe("@kept");
    expect(r.name).toBe("@kept");
    expect(r.mine).toBe(true);
  });
});

// isPreviewEnv gates the synthetic-comment injector so REAL users on the
// production domain never see it (F2). It must be true everywhere except the two
// production hostnames, and always true in dev.
describe("isPreviewEnv — synthetic injector gating", () => {
  const origLocation = window.location;
  const setHost = (hostname: string) =>
    Object.defineProperty(window, "location", { value: { ...origLocation, hostname }, writable: true, configurable: true });
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, "location", { value: origLocation, writable: true, configurable: true });
  });
  it("DEV build → always preview (true)", () => {
    vi.stubEnv("DEV", true);
    expect(isPreviewEnv()).toBe(true);
  });
  it("prod build on the real domain → NOT preview (false) for apex + www", () => {
    vi.stubEnv("DEV", false);
    setHost("www.sellerflowlive.com");
    expect(isPreviewEnv()).toBe(false);
    setHost("sellerflowlive.com");
    expect(isPreviewEnv()).toBe(false);
  });
  it("prod build on a Vercel preview host → preview (true)", () => {
    vi.stubEnv("DEV", false);
    setHost("sellerflow-git-claude-full-redesign.vercel.app");
    expect(isPreviewEnv()).toBe(true);
  });
});
