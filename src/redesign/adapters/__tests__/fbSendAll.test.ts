// FB-2 app adapter (adapters/fbSendAll.ts): what the phone keeps from the server's answer, and the
// tag a row shows (the seller's own marks win; a real Messenger send wins over "by hand").
import { describe, it, expect } from "vitest";
import { parseFbStatus, fbTagOf, fbCounts, fbInFilter, fbSendable, fbSessionOk, fbJobActive, type FbTag } from "../fbSendAll";

describe("parseFbStatus", () => {
  it("keeps only buyer numbers + known tags + times; anything else is dropped", () => {
    const s = parseFbStatus({ ok: true, access: true, allowed: true, needsMessaging: false, buyers: [
      { n: 2, tag: "sent", at: "2026-11-26T06:00:00Z" }, { n: 3, tag: "weird" }, { n: 0, tag: "not_sent" }, { n: 4, tag: "other_app", psid: "X", commentId: "Y" },
    ], job: { state: "running", total: 3, sent: 1, skipped: 0, failed: 0, extra: "no" } })!;
    expect([...s.buyers.entries()]).toEqual([[2, { tag: "sent", at: "2026-11-26T06:00:00Z" }], [4, { tag: "other_app", at: null }]]);
    expect(s.job).toEqual({ state: "running", oneBuyer: false, total: 3, sent: 1, skipped: 0, failed: 0, stop: null, startedAt: null, finishedAt: null });
    expect(fbJobActive(s.job)).toBe(true);
    expect(parseFbStatus({ ok: false })).toBeNull();
  });
});

describe("fbTagOf", () => {
  const saved = (status: "sent" | "skipped" | "cancelled") => ({ status, sentAt: null, hash: "h" });
  it.each([
    [undefined, undefined, "not_sent"],
    [{ tag: "other_app" }, undefined, "other_app"],
    [{ tag: "sent" }, saved("sent"), "sent"],          // the Messenger send wins over "by hand"
    [{ tag: "not_sent" }, saved("sent"), "by_hand"],
    [{ tag: "sent" }, saved("cancelled"), "cancelled"], // cancelled wins over everything
    [{ tag: "not_sent" }, saved("skipped"), "cant_message"],
  ] as const)("%j + %j → %s", (server, s, want) => {
    expect(fbTagOf(server as never, s as never)).toBe(want);
  });
});

describe("counts and filters", () => {
  it("K left = Not sent + Other chat app; Sent = sent + by hand; cancelled out of everything but All", () => {
    const tags: FbTag[] = ["not_sent", "other_app", "sent", "by_hand", "cant_message", "unknown", "sending", "cancelled"];
    expect(fbCounts(tags)).toEqual({ all: 8, active: 7, sent: 2, notSent: 5, left: 2, otherApp: 1 });
    expect(tags.filter(fbSendable)).toEqual(["not_sent", "other_app"]);
    expect(tags.filter((x) => fbInFilter(x, "sent"))).toEqual(["sent", "by_hand"]);
    expect(tags.filter((x) => fbInFilter(x, "not_sent"))).toEqual(["not_sent", "other_app", "cant_message", "unknown", "sending"]);
    expect(tags.filter((x) => fbInFilter(x, "all"))).toHaveLength(8);
  });
  it("a session id is needed (the server reads that session)", () => {
    expect(fbSessionOk("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(fbSessionOk("day:2026-11-26")).toBe(false);
    expect(fbSessionOk(null)).toBe(false);
  });
});
