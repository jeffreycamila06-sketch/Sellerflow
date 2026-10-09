// Build 10b — exposure fixes. Pins: /health answers {ok:true} publicly and the detail only with the
// poll token; the seller self-delete answer is { ok:true } / { ok:false, code } with no table names;
// preview flags come from the database as booleans only (no email in the bundle or on the device);
// the extension build output is minified, keeps the phone masked and has no localhost; the TikTok
// cooldown shows minutes in seller words; analytics get the code only.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerHealthRoutes } from "../../../server/healthRoutes.js";
import { makeFailureThrottle } from "../../../server/pollAuth.js";
import { errCodeOf, decodeServerJson } from "../errCodes.js";
import { connectFailText, connectPlatform, cooldownMinutes } from "../../redesign/adapters/connect";
import { buildT } from "../../redesign/i18n";
import { buildExtension } from "../../../scripts/build-extension.mjs";

const rpc = vi.fn();
vi.mock("../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: async () => ({ data: { session: null } }) } } }));
import { parseFeatureAccess, loadFeatureAccess, useFeatureAccess, hasFeature, FEATURE_KEYS, setFeatureAccess, featureAccessLoaded } from "../../redesign/adapters/featureAccess";

const ROOT = join(__dirname, "..", "..", "..");

describe("/health — public says ok, the detail needs the poll token", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  afterEach(() => { server?.close(); server = null; });
  async function serve(token: string) {
    const app = express();
    registerHealthRoutes(app, { token, tiktokDetail: () => ({ ok: true, service: "tiktok-signing", warnings: ["EULER_API_KEY is not set"] }), throttle: makeFailureThrottle({ max: 2, windowMs: 60_000 }) });
    await new Promise<void>((r) => { server = app.listen(0, r); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }
  const get = async (url: string, headers: Record<string, string> = {}) => { const r = await fetch(url, { headers }); return { status: r.status, text: await r.text() }; };

  it("public answers carry nothing but ok", async () => {
    const base = await serve("s3cret");
    expect(await get(`${base}/`)).toEqual({ status: 200, text: "OK" });
    expect(await get(`${base}/health`)).toEqual({ status: 200, text: '{"ok":true}' });
    expect(await get(`${base}/health/tiktok`)).toEqual({ status: 200, text: '{"ok":true}' });
  });
  it("the right X-Poll-Token gets the detail; a wrong one 403, then a lockout 429", async () => {
    const base = await serve("s3cret");
    const ok = await get(`${base}/health/tiktok`, { "X-Poll-Token": "s3cret" });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text).service).toBe("tiktok-signing");
    expect((await get(`${base}/health/tiktok`, { "X-Poll-Token": "nope" })).status).toBe(403);
    expect((await get(`${base}/health/tiktok`, { "X-Poll-Token": "nope" })).status).toBe(403);
    expect((await get(`${base}/health/tiktok`, { "X-Poll-Token": "s3cret" })).status).toBe(429);
  });
  it("no secret configured → never the detail", async () => {
    const base = await serve("");
    expect(await get(`${base}/health/tiktok`, { "X-Poll-Token": "anything" })).toEqual({ status: 200, text: '{"ok":true}' });
  });
  it("server.js: no framework header, the routes come from healthRoutes, the old public texts are gone", () => {
    const s = readFileSync(join(ROOT, "server.js"), "utf8");
    expect(s).toContain('app.disable("x-powered-by");');
    expect(s).toContain("registerHealthRoutes(app, { token: PARCEL_POLL_TOKEN, tiktokDetail: tiktokHealthDetail });");
    expect(s).not.toContain("SellerFlow TikTok Server Running");
    expect(s).not.toMatch(/app\.get\("\/health/);
    expect(s).not.toContain("TikTok LIVE already connected");
    expect(s).not.toMatch(/reused:\s*true/);
  });
});

describe("seller self-delete answer", () => {
  const src = readFileSync(join(ROOT, "supabase/functions/admin-delete-user/index.ts"), "utf8");
  const self = src.slice(src.indexOf('if (mode === "self") {'), src.indexOf("// ── GHOST modes"));
  it("success is { ok: true } only; a refusal is { ok: false, code } — never table names or text", () => {
    expect(self).toContain("return json({ ok: true });");
    expect(self).toContain("return json({ ok: false, code: guard.code }, 403);");
    expect(self).not.toMatch(/deleted:\s*wiped/);
    expect(self).not.toMatch(/error:\s*guard\.error/);
    expect(src).toContain('if (mode === "self") return json({ ok: false, code: "delete_failed" }, 500);');
  });
  it("guard texts are plain words", () => {
    const g = readFileSync(join(ROOT, "supabase/functions/admin-delete-user/guards.ts"), "utf8");
    expect(g).not.toContain("Use ghost cleanup for profile-less accounts");
    expect(g).not.toContain("can't self-delete —");
    expect(g).toContain("This account can't be deleted in the app. Message us and we'll do it.");
  });
});

describe("feature flags from the database (sql/112)", () => {
  beforeEach(() => { rpc.mockReset(); setFeatureAccess(null, false); localStorage.clear(); });
  it("only booleans for the known keys survive; anything else is false", () => {
    const a = parseFeatureAccess({ fb_preview: true, session_v2: "true", extra: true, pin_print: 1 });
    expect(Object.keys(a).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(a.fb_preview).toBe(true);
    expect(a.session_v2).toBe(false);
    expect(a.pin_print).toBe(false);
    expect(parseFeatureAccess(null).fb_preview).toBe(false);
  });
  it("fail closed: an RPC error or a throw → all false", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(Object.values(await loadFeatureAccess()).every((v) => v === false)).toBe(true);
    rpc.mockRejectedValueOnce(new Error("down"));
    expect(Object.values(await loadFeatureAccess()).every((v) => v === false)).toBe(true);
  });
  it("the hook loads once per user, sets the gates, and keeps only booleans on the device", async () => {
    rpc.mockResolvedValue({ data: { fb_preview: true }, error: null });
    const { result, rerender } = renderHook(({ id }) => useFeatureAccess(id), { initialProps: { id: "u1" as string | null } });
    await waitFor(() => expect(result.current.fb_preview).toBe(true));
    expect(hasFeature("fb_preview")).toBe(true);
    expect(featureAccessLoaded()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("my_feature_access");
    expect(localStorage.getItem("sfl_rd_fa_u1")).not.toMatch(/@/);
    rerender({ id: null });
    expect(hasFeature("fb_preview")).toBe(false); // signed out → nothing
    rerender({ id: "u1" });
    expect(hasFeature("fb_preview")).toBe(true);  // the cached answer shows from the first frame
  });
  it("no email address is left in any app source outside tests (except the support contact and placeholders)", () => {
    const allowed = new Set(["jeffreycamila06@gmail.com", "you@email.com", "maria@liveshop.ph", "seller@email.com", "admin@sellerflow.app"]);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "__tests__" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
    const hits: string[] = [];
    for (const f of walk(join(ROOT, "src/redesign")).concat(walk(join(ROOT, "src/lib")))) {
      if (!/\.(ts|tsx|js)$/.test(f)) continue;
      // code only (comments never reach the bundle); example.com / x.com = made-up placeholders
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      for (const m of code.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g)) {
        const e = m[0].toLowerCase().replace(/\.+$/, "");
        if (!allowed.has(e) && !/@(example\.com|x\.com)$/.test(e)) hits.push(`${f.slice(ROOT.length + 1)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("extension build (scripts/build-extension.mjs)", () => {
  const out = mkdtempSync(join(tmpdir(), "ext-"));
  const files = buildExtension(join(ROOT, "chrome-extension"), out);
  it("every .js is minified (no comment lines, much smaller) and still masks the sender phone", () => {
    for (const f of files.filter((n: string) => n.endsWith(".js"))) {
      const src = readFileSync(join(ROOT, "chrome-extension", f), "utf8");
      const min = readFileSync(join(out, f), "utf8");
      expect(min.length, f).toBeLessThan(src.length);
      expect(min, f).not.toMatch(/^\s*\/\//m);
    }
    const bg = readFileSync(join(out, "background.js"), "utf8");
    expect(bg).not.toMatch(/sender \$\{[a-z]\.sender_phone\}/);
    expect((bg.match(/pcMaskPhone\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it("the mask hides the middle of the number", () => {
    const fn = new Function(`${readFileSync(join(out, "background.js"), "utf8").match(/function pcMaskPhone\([^)]*\)\{[^}]*\}/)![0]}; return pcMaskPhone;`)();
    expect(fn("0912345678")).toBe("09******78");
    expect(fn("")).toBe("****");
  });
  it("manifest: no localhost; README is install-only", () => {
    const m = readFileSync(join(out, "manifest.json"), "utf8");
    expect(m).not.toContain("localhost");
    const readme = readFileSync(join(ROOT, "chrome-extension/README.md"), "utf8");
    expect(readme).not.toMatch(/byIDData|CheckoutValidation|tokenID|rest\/v1|apikey|supabase\.co|polls/i);
    expect(readme.split("\n").length).toBeLessThan(20);
  });
});

describe("TikTok cooldown minutes and the analytics code", () => {
  const t = buildT("en");
  const fil = buildT("fil");
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  it("E41 and E42 decode to minutes in seller words", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, statusText: "", json: async () => ({ success: false, error: "E41:12" }) })) as unknown as typeof fetch;
    const r = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
    expect(connectFailText(r, t)).toBe("Too many connects. Wait 12 minutes, then try again.");
    expect(connectFailText(r, fil)).toBe("Masyadong maraming connect. Maghintay ng 12 minuto, tapos subukan ulit.");
    expect(cooldownMinutes(decodeServerJson({ error: "E42:2 hour(s)" }).error)).toBe(120);
    expect(cooldownMinutes(decodeServerJson({ error: "E42:5 minute(s)" }).error)).toBe(5);
    expect(cooldownMinutes("E41")).toBeNull();
    expect(connectFailText({ error: "E0" }, t)).toBe(t.rd_cm_conn_try_again);
  });
  it("analytics reason = the code only", () => {
    expect(errCodeOf("not_live")).toBe("E8");
    expect(errCodeOf("E41:12")).toBe("E41");
    expect(errCodeOf("E150")).toBe("E150");
    expect(errCodeOf("the request user is not online")).toBe("E0");
    expect(errCodeOf(undefined)).toBe("E0");
    const app = readFileSync(join(ROOT, "src/redesign/RedesignApp.tsx"), "utf8");
    const tracks = [...app.matchAll(/track\("connect_failed", \{[^}]*\}\)/g)].map((m) => m[0]);
    expect(tracks.length).toBe(5);
    for (const x of tracks) expect(x).toMatch(/reason: errCodeOf\(/);
  });
});
