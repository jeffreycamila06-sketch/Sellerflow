// Audit Oct 13 item 10 — anti-framing + basic security headers on every path.
// ONLY frame-ancestors in the CSP (no other directive), and the git setting kept.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cfg = JSON.parse(readFileSync(resolve(__dirname, "../../../../vercel.json"), "utf8"));

describe("vercel.json", () => {
  it("keeps the git deployment setting", () => {
    expect(cfg.git).toEqual({ deploymentEnabled: { "**": false, main: true, "preview/**": true } });
  });
  it("sends the three headers on every path", () => {
    const block = cfg.headers.find((h: { source: string }) => h.source === "/(.*)");
    const map = Object.fromEntries(block.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(map).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
  });
});
