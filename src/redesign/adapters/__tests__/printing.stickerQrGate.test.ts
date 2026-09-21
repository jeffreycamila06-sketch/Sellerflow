// Print-time entitlement gate for the sticker QR (Plus/Pro/Master+admin only). The QR
// stamps ONLY when the per-device toggle is on AND the account is entitled — so a stored
// toggle "1" on a downgraded/Basic account NEVER prints a QR. Fail-closed default.
import { describe, it, expect, beforeEach } from "vitest";
import { isStickerQrOn, setStickerQrOn, isStickerQrEntitled, setStickerQrEntitled, stickerQrEffective } from "../printing";

beforeEach(() => {
  // Deterministic in-memory localStorage (isolated node runs don't provide one).
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null, length: 0,
  } as unknown as Storage;
  setStickerQrEntitled(false); // reset the module flag between tests
});

describe("sticker QR print-time entitlement gate", () => {
  it("entitlement defaults false (FAIL-CLOSED) and round-trips", () => {
    expect(isStickerQrEntitled()).toBe(false);
    setStickerQrEntitled(true); expect(isStickerQrEntitled()).toBe(true);
    setStickerQrEntitled(false); expect(isStickerQrEntitled()).toBe(false);
    setStickerQrEntitled(1 as unknown as boolean); expect(isStickerQrEntitled()).toBe(false); // only true===true
  });

  it("NEVER stamps when NOT entitled — even with the toggle stored ON", () => {
    setStickerQrOn(true);
    expect(isStickerQrOn()).toBe(true);   // stored toggle is on…
    setStickerQrEntitled(false);
    expect(stickerQrEffective()).toBe(false); // …but a non-Plus/Pro/Master account prints no QR
  });

  it("stamps ONLY when BOTH the toggle is on AND the account is entitled", () => {
    setStickerQrEntitled(true);
    setStickerQrOn(false); expect(stickerQrEffective()).toBe(false); // entitled but toggle off
    setStickerQrOn(true);  expect(stickerQrEffective()).toBe(true);  // Plus/Pro/Master + toggle on
    setStickerQrEntitled(false); expect(stickerQrEffective()).toBe(false); // downgrade → inert immediately
  });
});
