// Build 11 (M8) — a broken request must never show the program trace, whatever NODE_ENV is.
// Real express + the real JSON parser + the real handler (server/finalErrorHandler.js).
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { finalErrorHandler } from "../../../../server/finalErrorHandler.js";

let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
afterEach(() => { server?.close(); server = null; });

async function serve(withHandler: boolean, logs: string[] = []) {
  const app = express();
  app.use(express.json());
  app.post("/fb/connect", (_q, res) => res.json({ ok: true }));
  app.get("/boom", () => { throw new Error("secret detail /home/app/server.js:123"); });
  if (withHandler) app.use(finalErrorHandler({ log: (l: string) => logs.push(l) }));
  await new Promise<void>((r) => { server = app.listen(0, r); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const broken = (base: string) => fetch(`${base}/fb/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });

describe("final error handler", () => {
  it("without it (today), a broken JSON body answers with the stack trace (NODE_ENV unset)", async () => {
    const prev = process.env.NODE_ENV; delete process.env.NODE_ENV;
    try {
      const r = await broken(await serve(false));
      expect(r.status).toBe(400);
      expect(await r.text()).toMatch(/node_modules|at /);
    } finally { if (prev !== undefined) process.env.NODE_ENV = prev; }
  });

  for (const env of [undefined, "development", "production"]) {
    it(`with it: plain answer, no trace (NODE_ENV=${env ?? "unset"})`, async () => {
      const prev = process.env.NODE_ENV;
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      try {
        const logs: string[] = [];
        const base = await serve(true, logs);
        const r = await broken(base);
        expect(r.status).toBe(400);
        const text = await r.text();
        expect(JSON.parse(text)).toEqual({ ok: false, error: "bad_request" });
        expect(text).not.toMatch(/node_modules|at |SyntaxError/);
        const r2 = await fetch(`${base}/boom`);
        expect(r2.status).toBe(500);
        const t2 = await r2.text();
        expect(JSON.parse(t2)).toEqual({ ok: false, error: "server_error" });
        expect(t2).not.toContain("secret detail");
        // the detail stays in the server log
        expect(logs.some((l) => l.includes("[HTTP-ERR] GET /boom 500") && l.includes("secret detail"))).toBe(true);
        // a good request is untouched
        const ok = await fetch(`${base}/fb/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(await ok.json()).toEqual({ ok: true });
      } finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
    });
  }

  it("server.js mounts it once, after every route and route module", () => {
    const s = readFileSync(join(__dirname, "..", "..", "..", "..", "server.js"), "utf8");
    const mount = s.indexOf("app.use(finalErrorHandler());");
    expect(mount).toBeGreaterThan(0);
    expect(s.indexOf("app.use(finalErrorHandler());", mount + 1)).toBe(-1);
    const lastRoute = Math.max(...[...s.matchAll(/app\.(?:get|post|use|all)\(|registerRoutes\(app|registerHealthRoutes\(app/g)].map((m) => m.index!).filter((i) => i !== mount));
    expect(mount).toBeGreaterThan(lastRoute);
    expect(mount).toBeLessThan(s.indexOf("server.listen(PORT"));
  });
});
