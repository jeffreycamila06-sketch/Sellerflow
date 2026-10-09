// M6 (security audit 2026-09-26) — the admin-delete-user edge function matches
// emails EXACTLY, never with ilike (whose _ / % wildcards let a typo'd hard-delete
// resolve to a DIFFERENT seller — 4 real seller emails contain "_"), and a
// self-delete 500 returns a GENERIC error (details to the function logs only; the
// admin modes keep the full message per the 2026-07-24 rule). Source-contract pins
// over the edge file (deployed via Supabase edge deploy — byte-diffed vs this file
// after merge, per the 2026-07-24 EDGE-FUNCTION DEPLOY RULE).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const fn = readFileSync("supabase/functions/admin-delete-user/index.ts", "utf8");

describe("M6 — exact email matching in admin-delete-user", () => {
  it("zero ilike anywhere in the function", () => {
    expect(fn).not.toContain(".ilike(");
  });

  it("both email lookups are exact eq on the (lowercased) email", () => {
    expect(fn).toContain('.from("support_messages").delete().eq("email", email)');
    expect(fn).toContain('.select("auth_user_id, role, plan").eq("email", email).maybeSingle()');
  });

  it("both entry points lowercase the email before use (storage is lowercase, DB-verified)", () => {
    // admin "user" mode target + self mode both normalize:
    expect(fn.match(/\.trim\(\)\.toLowerCase\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("M6 — the outer catch is mode-aware", () => {
  const iCatch = fn.lastIndexOf("} catch (e) {");
  const tail = fn.slice(iCatch);

  it("full details go to the function logs, BEFORE any response", () => {
    const iLog = tail.indexOf("console.error(`[admin-delete-user] mode=${mode} failed:`");
    const iReturn = tail.indexOf("return json(");
    expect(iLog).toBeGreaterThan(-1);
    expect(iLog).toBeLessThan(iReturn);
  });

  it("self mode → the code delete_failed; admin modes get a plain sentence, the detail stays in the function log (Build 10b)", () => {
    expect(tail).toContain('if (mode === "self") return json({ ok: false, code: "delete_failed" }, 500);');
    expect(tail).toContain(`return json({ success: false, error: "Couldn't delete this account. Please try again." }, 500);`);
    expect(tail).toContain("console.error(`[admin-delete-user] mode=${mode} failed:`, detail);");
    // The old raw-leak-to-everyone return is gone:
    expect(fn).not.toContain('error: e instanceof Error ? e.message : "delete_failed"');
  });
});
