// H1 follow-up — FB + Shopee comment payloads must carry the EMAIL id, not the auth UUID.
// Rooms key on the UUID, but every client drops a comment whose sellerId !== its own
// email id (useLiveFeed: `if (c.sellerId && c.sellerId !== sellerId) return;`). The FB
// and Shopee runtimes build the payload with entry.sellerId (= req.sellerId = UUID), so
// the server.js wiring must rewrite the field with emailIdOf before emitCommentScoped.
//
// server.js has no test harness (it boots the server on import), so this runs the REAL
// emitComment arrow functions taken from server.js source, with stand-ins for
// emitCommentScoped / emailIdOf, fed by the REAL fbToPayload / shopeeToPayload.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fbToPayload } from "../../../../server/fbComment.js";
import { shopeeToPayload } from "../../../../server/shopeeComment.js";

const SERVER = readFileSync("server.js", "utf8");
const UUID = "7f9c2a1e-3b4d-4e5f-8a6b-1c2d3e4f5a6b";
const EMAIL_ID = "seller@example.com";

// The one-line `emitComment: (...) => { ... },` inside createXRuntime({ ... }).
function wiring(platform: "Facebook" | "Shopee") {
  const line = SERVER.split("\n").find((l) => /^\s*emitComment: \(/.test(l) && l.includes(`"${platform}"`));
  if (!line) throw new Error(`no ${platform} emitComment wiring in server.js`);
  const arrow = line.trim().replace(/^emitComment:\s*/, "").replace(/,\s*$/, "");
  const calls: { sellerId: string; platform: string; scope: string; payload: Record<string, unknown> }[] = [];
  const emitCommentScoped = (sellerId: string, plat: string, scope: string, payload: Record<string, unknown>) => { calls.push({ sellerId, platform: plat, scope, payload }); };
  const emailIdOf = (id: string) => (id === UUID ? EMAIL_ID : "");
  const fn = new Function("emitCommentScoped", "emailIdOf", `return (${arrow});`)(emitCommentScoped, emailIdOf) as (a: string, b: string, p: unknown) => void;
  return { fn, calls };
}

describe("FB / Shopee comment payloads carry the email id (client filter), rooms stay on the UUID", () => {
  it("Facebook: the comment sent to the client has sellerId = email id, not the UUID", () => {
    const payload = fbToPayload({ id: "LV_1", message: "mine", from: { id: "99", name: "Ann" } }, { sellerId: UUID, sessionId: "s1", pageId: "P1", liveVideoId: "LV", pageUsername: "mypage" });
    expect(payload.sellerId).toBe(UUID);                     // the runtime hands the wiring a UUID
    const { fn, calls } = wiring("Facebook");
    fn(UUID, "mypage", payload);
    expect(calls).toHaveLength(1);
    expect(calls[0].sellerId).toBe(UUID);                    // room key unchanged
    expect(calls[0].platform).toBe("Facebook");
    expect(calls[0].payload.sellerId).toBe(EMAIL_ID);        // what the client filter compares
    expect(calls[0].payload.sellerId).not.toBe(UUID);
    expect({ ...calls[0].payload, sellerId: UUID }).toEqual(payload); // nothing else changed
  });

  it("Shopee: same rule", () => {
    const payload = shopeeToPayload({ comment_id: "c1", comment: "mine", username: "bob" }, { sellerId: UUID, sessionId: "s1", shopSessionId: "S9", shopId: 7, shopUsername: "7" });
    expect(payload.sellerId).toBe(UUID);
    const { fn, calls } = wiring("Shopee");
    fn(UUID, "7", payload);
    expect(calls[0].sellerId).toBe(UUID);
    expect(calls[0].platform).toBe("Shopee");
    expect(calls[0].payload.sellerId).toBe(EMAIL_ID);
    expect({ ...calls[0].payload, sellerId: UUID }).toEqual(payload);
  });

  it("the client would accept it: payload.sellerId equals the email id the client computes", () => {
    const { fn, calls } = wiring("Facebook");
    fn(UUID, "mypage", fbToPayload({ id: "x" }, { sellerId: UUID }));
    const clientSellerId = " Seller@Example.com ".trim().toLowerCase(); // sellerIdOf(email)
    const c = calls[0].payload;
    expect(!(c.sellerId && c.sellerId !== clientSellerId)).toBe(true);  // useLiveFeed keeps it
  });
});
