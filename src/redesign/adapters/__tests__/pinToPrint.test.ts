// PIN-TO-PRINT Phase 2 — client core behavioral tests + wiring pins.
// The order-creation path itself is the EXISTING createOrder (its msgId dedup /
// cap tests live in useOrders.*); these tests own the pin-specific layer:
// actionability, the Comment construction, the sold-out skip, and the wiring
// contracts (toggle default OFF, toggle-inside-effect, seq-once, account scoping).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isActionablePin, buildPinComment, shouldSkipPin, pinPrintAllowed, PIN_PRINT_LS_KEY, PIN_PRINT_PUBLIC } from "../pinToPrint";

const good = { pinned: true, platform: "TikTok", username: "myshop", handle: "ann", name: "Ann", comment: "mine!", msgId: "m1", time: "9:41 PM", timestamp: "2026-09-27T01:00:00Z", sellerId: "a@b.com", sessionId: "s", sourceUsername: "myshop", avatar: "u" };

describe("isActionablePin — defense in depth (mirrors the server validity gate)", () => {
  it("full payload → actionable; TikTok casing is case-insensitive", () => {
    expect(isActionablePin(good)).toBe(true);
    expect(isActionablePin({ ...good, platform: "tiktok" })).toBe(true);
  });
  it("missing msgId / handle / text / wrong platform → never an order", () => {
    expect(isActionablePin(null)).toBe(false);
    expect(isActionablePin({ ...good, msgId: "" })).toBe(false);
    expect(isActionablePin({ ...good, handle: "" })).toBe(false);
    expect(isActionablePin({ ...good, comment: "  " })).toBe(false);
    expect(isActionablePin({ ...good, platform: "Facebook" })).toBe(false);
  });
});

describe("buildPinComment — self-contained (no feed row needed)", () => {
  it("produces the exact ProdComment shape the 1-Click path consumes, msgId riding along", () => {
    expect(buildPinComment(good)).toEqual({
      handle: "ann", name: "Ann", comment: "mine!", platform: "TikTok",
      isBuy: false, buyerNum: null, buyerData: null,
      time: "9:41 PM", avatar: "u", timestamp: "2026-09-27T01:00:00Z",
      sellerId: "a@b.com", sessionId: "s", sourceUsername: "myshop", msgId: "m1",
    });
  });
  it("blank name falls back to the handle", () => {
    expect(buildPinComment({ ...good, name: "" }).name).toBe("ann");
  });
});

describe("shouldSkipPin — unattended orders never oversell", () => {
  it("sold-out auto code → skip; anything else → proceed", () => {
    expect(shouldSkipPin("D")).toBe(true);
    expect(shouldSkipPin(null)).toBe(false);
  });
});

describe("wiring pins (source contracts)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const feed = readFileSync("src/redesign/adapters/useLiveFeed.ts", "utf8");

  it("toggle: per-device LS key, DEFAULT OFF, read via ref INSIDE the effect", () => {
    expect(PIN_PRINT_LS_KEY).toBe("sfl_rd_pin_print");
    expect(app).toContain('pinPrint: "sfl_rd_pin_print"');
    expect(app).toContain('readLS(LS.pinPrint, "0") === "1"'); // default OFF
    expect(app).toContain("if (!pinPrint) return;"); // toggle gate, fresh closure via the effect mirror
    expect(app).toContain("useEffect(() => { pinHandlerRef.current = handlePinned; });"); // effect mirror — no render-time ref write
  });

  it("the consumer routes through the REAL createOrder (dedup/cap for free) and skips sold-out", () => {
    const i = app.indexOf("PIN-TO-PRINT (Phase 2, Option A)");
    const block = app.slice(i, app.indexOf("const onOpenEnt", i));
    expect(block).toContain("if (!isActionablePin(p)) return;");
    expect(block).toContain("shouldSkipPin(soldOutCodeForComment(c.comment))");
    expect(block).toContain("orders.createOrder(c, 0)");
    expect(block).toContain("liveSession.addOrderedMsgId(c.msgId, snap)");
    // the handler rides the onComment-style seam (each relay fires it once —
    // the listener's msgId seen-set is the once-guard):
    expect(app).toContain("(p) => pinHandlerRef.current(p)");
  });

  it("useLiveFeed platform_pin listener: seller filter, case-insensitive platform, tracked-account match, msgId seen-set, user-switch reset", () => {
    const i = feed.indexOf('s.on("platform_pin"');
    expect(i).toBeGreaterThan(-1);
    const block = feed.slice(i, i + 1600);
    expect(block).toContain("if (p.sellerId && p.sellerId !== sellerId) return;");
    expect(block).toContain('String(p.platform || "").toLowerCase() !== "tiktok"');
    expect(block).toContain("trackedAcctRef.current.TikTok");
    expect(block).toContain("pinSeenRef.current.has(msgId)");
    // Audit F1 — SINGLE CONSUMER: sessionId scoping mirrors the chat lane, so
    // two toggled-on devices can never both consume one pin (double billing).
    expect(block).toContain("if (p.sessionId && p.sessionId !== sessionId) return;");
    expect(block).toContain("onPinnedRef.current?.(p)");
    expect(feed).toContain("useEffect(() => { pinSeenRef.current = new Set(); }, [email]);"); // user-switch reset (effect, not render)
  });

  it("GeneralSettings renders the toggle in the LIVE SESSION card (keep-awake pattern)", () => {
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain("t.rd_set_pinprint");
    expect(gs).toContain("onTogglePinPrint");
  });
});

describe("DOGFOOD GATE — pinPrintAllowed (allowlist + admin; NOT plan-gated)", () => {
  it("the release flip is currently OFF (dogfood phase)", () => {
    expect(PIN_PRINT_PUBLIC).toBe(false);
  });
  it("allowlisted emails + every budgetukay* + admins pass; everyone else fails", () => {
    for (const e of ["budgetukay5@gmail.com", "BUDGETUKAY2@gmail.com", "budgetukay_anything@x.com",
                     "ronaldgantiga77@gmail.com", "tincabanas13@gmail.com", "cristycabanas34@gmail.com",
                     "googletest@gmail.com", "googletest@sellerflowlive.com"]) {
      expect(pinPrintAllowed(e, "seller"), e).toBe(true);
    }
    expect(pinPrintAllowed("random@seller.com", "admin")).toBe(true);   // admin bypass
    expect(pinPrintAllowed("random@seller.com", "Admin")).toBe(true);   // display-cased role
    expect(pinPrintAllowed("random@seller.com", "seller")).toBe(false);
    expect(pinPrintAllowed("", "seller")).toBe(false);
    expect(pinPrintAllowed(null, null)).toBe(false);
    // NOT a prefix trap: an email merely CONTAINING budgetukay doesn't pass
    expect(pinPrintAllowed("not-budgetukay@x.com", "seller")).toBe(false);
  });
  it("gate wiring: the handler gates FIRST, and the toggle row only renders for the allowlisted", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const pinAllowed = pinPrintAllowed(auth.profile?.email, auth.profile?.role);");
    const i = app.indexOf("const handlePinned");
    const block = app.slice(i, i + 900);
    expect(block).toContain("if (!liveSession.orderedLoaded) return;"); // audit F2 — the E1 gate for unattended orders
    expect(block.indexOf("if (!pinAllowed) return;")).toBeGreaterThan(-1);
    expect(block.indexOf("if (!pinAllowed) return;")).toBeLessThan(block.indexOf("if (!pinPrint) return;")); // gate before toggle
    expect(app).toContain("onTogglePinPrint={pinAllowed ? togglePinPrint : undefined}");
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain("{onTogglePinPrint && <div");
  });
});
