// #4 — rate-limit cooldown resolver (server.js has no vitest harness; the pure
// core lives in server/connectionHealth.js). Honor Euler's own reset window
// (Retry-After / X-RateLimit-Reset on the SignatureRateLimitError), else a 30-min
// default — NOT the old fixed 24h that could lock a paying seller out for a day.
import { describe, it, expect } from "vitest";
import {
  resolveRateLimitCooldownMs, RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MIN_MS, RATE_LIMIT_MAX_MS,
} from "../../../../server/connectionHealth.js";

const NOW = 1_760_000_000_000;

describe("resolveRateLimitCooldownMs", () => {
  it("no headers → 30-min default (not 24h)", () => {
    expect(resolveRateLimitCooldownMs({}, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs({ retryAfter: 0, resetTime: undefined }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs(null, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(RATE_LIMIT_DEFAULT_MS).toBe(30 * 60 * 1000);
  });
  it("honors Retry-After (ms) when present", () => {
    expect(resolveRateLimitCooldownMs({ retryAfter: 5 * 60 * 1000 }, NOW)).toBe(5 * 60 * 1000);
  });
  it("prefers the absolute reset time over Retry-After", () => {
    const reset = NOW + 12 * 60 * 1000; // 12 min out
    expect(resolveRateLimitCooldownMs({ retryAfter: 5 * 60 * 1000, resetTime: reset }, NOW)).toBe(12 * 60 * 1000);
  });
  it("ignores a reset time already in the past → falls to Retry-After / default", () => {
    expect(resolveRateLimitCooldownMs({ resetTime: NOW - 1000 }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs({ resetTime: NOW - 1000, retryAfter: 2 * 60 * 1000 }, NOW)).toBe(2 * 60 * 1000);
  });
  it("clamps: floor 1 min, ceiling 24h (never thrash, never worse than before)", () => {
    expect(resolveRateLimitCooldownMs({ retryAfter: 500 }, NOW)).toBe(RATE_LIMIT_MIN_MS);        // 0.5s → 1 min
    expect(resolveRateLimitCooldownMs({ retryAfter: 999 * 60 * 60 * 1000 }, NOW)).toBe(RATE_LIMIT_MAX_MS); // huge → 24h
    expect(RATE_LIMIT_MIN_MS).toBe(60 * 1000);
    expect(RATE_LIMIT_MAX_MS).toBe(24 * 60 * 60 * 1000);
  });
  it("defensive: a wrapped error that lost the fields → default (still far better than 24h)", () => {
    expect(resolveRateLimitCooldownMs({ message: "rate_limit" }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
  });
});
