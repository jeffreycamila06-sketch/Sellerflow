// Audit Oct 13 item 9 — production server logs carry no buyer data and no seller emails.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "../../../..");
const server = readFileSync(join(root, "server.js"), "utf8");
const files = [server, ...readdirSync(join(root, "server")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(root, "server", f), "utf8"))];
const logLines = files.flatMap((src) => src.split("\n").filter((l) => /console\.(log|warn|error|info)\(|\blog\(`/.test(l)));

describe("server logs (source contract)", () => {
  it("the [PIN-PROBE] raw JSON dump is gone", () => {
    expect(server).not.toMatch(/console\.log\(`\[PIN-PROBE\] /);
    expect(server).not.toMatch(/JSON\.stringify\(obj\)\.slice\(0, 2000\)/);
  });
  it("the pin relay line has no @handle", () => {
    const line = logLines.find((l) => l.includes("[PIN-RELAY] ${cleanUsername} msgId="));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/@\$\{/);
  });
  it("no log line interpolates an email", () => {
    for (const l of logLines) expect(l).not.toMatch(/\$\{[^}]*\b(userEmail|email)\b[^}]*\}/);
  });
  it("PLAN_CHECK context is the seller id", () => {
    expect(server).toContain('const ctx = `seller=${authUserId || "(unknown)"}`;');
  });
});
