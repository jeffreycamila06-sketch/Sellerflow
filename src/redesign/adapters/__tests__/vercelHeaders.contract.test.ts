// Audit Oct 13 item 10 — anti-framing + basic security headers on every path.
// ONLY frame-ancestors in the CSP (no other directive), and the git setting kept.
// Audit Oct 22 item 15 — Permissions-Policy (camera stays (self): Parcel Scan's in-app camera is
// the page's own getUserMedia, no iframe) + HSTS.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cfg = JSON.parse(readFileSync(resolve(__dirname, "../../../../vercel.json"), "utf8"));

describe("vercel.json", () => {
  it("keeps the git deployment setting", () => {
    expect(cfg.git).toEqual({ deploymentEnabled: { "**": false, main: true, "preview/**": true } });
  });
  it("sends the five headers on every path", () => {
    const block = cfg.headers.find((h: { source: string }) => h.source === "/(.*)");
    const map = Object.fromEntries(block.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(map).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
  });
  it("Permissions-Policy keeps the camera for our own origin (Parcel Scan) and nothing else", () => {
    const block = cfg.headers.find((h: { source: string }) => h.source === "/(.*)");
    const pp = block.headers.find((h: { key: string }) => h.key === "Permissions-Policy").value as string;
    expect(pp).toMatch(/(^|, )camera=\(self\)/);
    expect(pp).not.toMatch(/camera=\(\)/);
    expect(readFileSync(resolve(__dirname, "../../screens/ParcelScan.tsx"), "utf8")).toContain("navigator.mediaDevices.getUserMedia(");
  });
});
