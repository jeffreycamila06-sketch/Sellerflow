// Pure helpers for the in-app Parcel Scan camera. The imperative stream/canvas
// lifecycle lives in the screen (DOM-bound); here we prove the feature-detect,
// constraints shape, haptic guard, track-stop, and error-name normalization.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cameraSupported, captureConstraints, triggerHaptic, stopStream, getUserMediaErrorName } from "../camera";

const nav = navigator as unknown as Record<string, unknown>;
const orig: Record<string, unknown> = {};
const set = (key: string, val: unknown) => { if (!(key in orig)) orig[key] = (nav as Record<string, unknown>)[key]; Object.defineProperty(navigator, key, { value: val, configurable: true }); };

afterEach(() => {
  for (const [k, v] of Object.entries(orig)) Object.defineProperty(navigator, k, { value: v, configurable: true });
  for (const k of Object.keys(orig)) delete orig[k];
  vi.restoreAllMocks();
});

describe("cameraSupported", () => {
  it("true only when navigator.mediaDevices.getUserMedia is a function", () => {
    set("mediaDevices", { getUserMedia: () => Promise.resolve({} as MediaStream) });
    expect(cameraSupported()).toBe(true);
  });
  it("false when mediaDevices is absent (jsdom default / http origin)", () => {
    set("mediaDevices", undefined);
    expect(cameraSupported()).toBe(false);
  });
  it("false when getUserMedia is not a function", () => {
    set("mediaDevices", {});
    expect(cameraSupported()).toBe(false);
  });
});

describe("captureConstraints", () => {
  it("prefers the rear camera with ideal (not exact) so front-only devices still open", () => {
    const c = captureConstraints() as { video: { facingMode: { ideal: string }; width: { ideal: number } }; audio: boolean };
    expect(c.audio).toBe(false);
    expect(c.video.facingMode).toEqual({ ideal: "environment" });
    expect(c.video.width.ideal).toBeGreaterThan(0);
    // no `exact` anywhere → never OverconstrainedError
    expect(JSON.stringify(c)).not.toContain("exact");
  });
});

describe("triggerHaptic", () => {
  it("calls navigator.vibrate when present", () => {
    const vibrate = vi.fn(() => true);
    set("vibrate", vibrate);
    triggerHaptic(30);
    expect(vibrate).toHaveBeenCalledWith(30);
  });
  it("is a silent no-op (no throw) when vibrate is unsupported", () => {
    set("vibrate", undefined);
    expect(() => triggerHaptic()).not.toThrow();
  });
});

describe("stopStream", () => {
  it("stops every track", () => {
    const a = { stop: vi.fn() }, b = { stop: vi.fn() };
    stopStream({ getTracks: () => [a, b] } as unknown as MediaStream);
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.stop).toHaveBeenCalledTimes(1);
  });
  it("is null-safe", () => {
    expect(() => stopStream(null)).not.toThrow();
    expect(() => stopStream(undefined)).not.toThrow();
  });
});

describe("getUserMediaErrorName", () => {
  it("returns the DOMException-style name", () => {
    expect(getUserMediaErrorName({ name: "NotAllowedError" })).toBe("NotAllowedError");
    expect(getUserMediaErrorName({ name: "NotFoundError" })).toBe("NotFoundError");
  });
  it("falls back to a stable code for odd shapes", () => {
    expect(getUserMediaErrorName(new Error("boom"))).toBe("Error"); // Error has a .name
    expect(getUserMediaErrorName("nope")).toBe("camera_error");
    expect(getUserMediaErrorName(null)).toBe("camera_error");
  });
});
