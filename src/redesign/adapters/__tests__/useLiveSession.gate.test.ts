// Buyer#-stability (2026-08) — isSessionUnready is the pure gate that decides
// whether createOrder may mint a buyer number right now. It BLOCKS while a load
// is in flight or FAILED (so no resell-from-#1 / hydrate-on-empty poisoning) and
// ALLOWS the resolved-and-trustworthy states. Matrix-pinned.
import { describe, it, expect } from "vitest";
import { isSessionUnready } from "../useLiveSession";

describe("isSessionUnready — order-creation gate", () => {
  it("BLOCKS while loading (rows still arriving → #1 would poison hydrate-on-empty)", () => {
    expect(isSessionUnready("loading", false)).toBe(true);
  });
  it("BLOCKS on a failed null-return load (state 'empty' + loadError)", () => {
    expect(isSessionUnready("empty", true)).toBe(true);
  });
  it("BLOCKS on a thrown load error (state 'idle' + loadError)", () => {
    expect(isSessionUnready("idle", true)).toBe(true);
  });
  it("ALLOWS a live session", () => {
    expect(isSessionUnready("live", false)).toBe(false);
  });
  it("ALLOWS a genuinely-empty resolved day (no error) → real new session starts at #1", () => {
    expect(isSessionUnready("empty", false)).toBe(false);
  });
  it("ALLOWS not-wired/sample mode (idle, no error) → local-only, no DB to disagree with", () => {
    expect(isSessionUnready("idle", false)).toBe(false);
  });
});
