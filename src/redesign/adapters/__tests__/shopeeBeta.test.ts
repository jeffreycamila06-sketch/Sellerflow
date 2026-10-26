// Shopee Live BETA — access rule + platform locks (sql/135). Pure, no DB.
//   allowed = admin OR (row AND expires_at > now); beta on a non-paid plan → TikTok/FB/IG
//   locked; paid plan keeps everything; beta ended → Shopee locked; TW + PH markets only.
import { describe, it, expect } from "vitest";
import { shopeeBetaAccess, shopeeBetaLocks, shopeeBetaMarketOk } from "../shopeeBeta";

const now = Date.parse("2026-10-27T00:00:00Z");
const row = (daysFromNow: number) => ({ expiresAt: new Date(now + daysFromNow * 86_400_000).toISOString(), shopeeUid: "123" });

describe("shopeeBetaAccess", () => {
  it("admin → always allowed, no countdown", () => {
    expect(shopeeBetaAccess({ isAdmin: true, row: null, now })).toEqual({ allowed: true, expired: false, daysLeft: null });
    expect(shopeeBetaAccess({ isAdmin: true, row: row(-5), now })).toEqual({ allowed: true, expired: false, daysLeft: null });
  });
  it("no row → not allowed, not expired", () => {
    expect(shopeeBetaAccess({ isAdmin: false, row: null, now })).toEqual({ allowed: false, expired: false, daysLeft: null });
  });
  it("active row → allowed with days left (rounded up)", () => {
    expect(shopeeBetaAccess({ isAdmin: false, row: row(30), now })).toEqual({ allowed: true, expired: false, daysLeft: 30 });
    expect(shopeeBetaAccess({ isAdmin: false, row: row(0.2), now }).daysLeft).toBe(1);
  });
  it("expired row → locked out, expired flag", () => {
    expect(shopeeBetaAccess({ isAdmin: false, row: row(0), now })).toEqual({ allowed: false, expired: true, daysLeft: 0 });
    expect(shopeeBetaAccess({ isAdmin: false, row: row(-3), now }).expired).toBe(true);
  });
  it("a malformed expires_at never grants access", () => {
    expect(shopeeBetaAccess({ isAdmin: false, row: { expiresAt: "soon", shopeeUid: null }, now }).allowed).toBe(false);
  });
});

describe("shopeeBetaLocks", () => {
  const active = shopeeBetaAccess({ isAdmin: false, row: row(10), now });
  const ended = shopeeBetaAccess({ isAdmin: false, row: row(-1), now });
  const none = shopeeBetaAccess({ isAdmin: false, row: null, now });
  it("active beta on a free / expired plan → TikTok, Facebook, Instagram locked (Shopee open)", () => {
    expect(shopeeBetaLocks({ isAdmin: false, access: active, paidActive: false })).toEqual({
      TikTok: "rd_sh_lock_beta_only", Facebook: "rd_sh_lock_beta_only", Instagram: "rd_sh_lock_beta_only",
    });
  });
  it("active beta with an active paid plan → nothing locked", () => {
    expect(shopeeBetaLocks({ isAdmin: false, access: active, paidActive: true })).toEqual({});
  });
  it("beta ended → only Shopee locked (TikTok stays usable on any plan)", () => {
    expect(shopeeBetaLocks({ isAdmin: false, access: ended, paidActive: false })).toEqual({ Shopee: "rd_sh_lock_ended" });
  });
  it("never in the beta → nothing locked; admin → nothing locked even on a free plan", () => {
    expect(shopeeBetaLocks({ isAdmin: false, access: none, paidActive: false })).toEqual({});
    expect(shopeeBetaLocks({ isAdmin: true, access: active, paidActive: false })).toEqual({});
  });
});

describe("shopeeBetaMarketOk", () => {
  it("TW and PH only; admin 'All' view passes", () => {
    expect(shopeeBetaMarketOk({ market: { country: "TW" }, adminUnion: false })).toBe(true);
    expect(shopeeBetaMarketOk({ market: { country: "PH" }, adminUnion: false })).toBe(true);
    expect(shopeeBetaMarketOk({ market: { country: "VN" }, adminUnion: false })).toBe(false);
    expect(shopeeBetaMarketOk({ market: { country: "VN" }, adminUnion: true })).toBe(true);
  });
});
