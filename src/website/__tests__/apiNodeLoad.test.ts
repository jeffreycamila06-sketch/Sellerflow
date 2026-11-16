// api/*.ts run in PLAIN NODE on Vercel ("type": "module"): every relative import needs ".js".
// Production 500 on /s/<sub> (2026-11-15): `import … from "../src/website/og"` — fine in Vite /
// Vitest, ERR_MODULE_NOT_FOUND in Node. These tests run scripts/check-api-node.mjs, which compiles
// api/ file by file (no bundler), loads it in a real Node process and runs the shop page once.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT = resolve("scripts/check-api-node.mjs");
const node = (args: string[]) => spawnSync(process.execPath, args, { encoding: "utf8", cwd: resolve(".") });

describe("api/ functions load in plain Node", () => {
  it("the real api/ folder passes: imports have .js, every function loads, the shop page answers 200", () => {
    const r = node([SCRIPT]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("loaded in Node: api/shop.js");
    expect(r.stdout).toContain("loaded in Node: api/geo.js");
    expect(r.stdout).toContain("ran in Node: api/shop.js → 200 with the shop's tags");
  });

  it("api/shop.ts imports og with the .js extension", () => {
    expect(readFileSync("api/shop.ts", "utf8")).toContain('from "../src/website/og.js"');
  });

  it("an extensionless relative import in api/ is caught (the 2026-11-15 bug)", () => {
    const root = mkdtempSync(join(tmpdir(), "sfl-api-bad-"));
    try {
      mkdirSync(join(root, "api")); mkdirSync(join(root, "lib"));
      writeFileSync(join(root, "lib", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "lib", "b.ts"), 'export { a } from "./a";\n'); // reached from api/ → also checked
      writeFileSync(join(root, "api", "ok.ts"), 'import { a } from "../lib/a.js";\nimport type { X } from "../lib/x";\nexport default () => a;\n');
      writeFileSync(join(root, "api", "bad.ts"), 'import { a } from "../lib/a";\nimport { b } from "../lib/b.js";\nexport default () => a + b;\n');
      const code = `const m = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log(JSON.stringify(m.checkApi({ root: ${JSON.stringify(root)} }).problems));`;
      const r = node(["--input-type=module", "-e", code]);
      expect(r.status).toBe(0);
      const problems: string[] = JSON.parse(r.stdout.trim());
      expect(problems.some((p) => p.startsWith("api/bad.ts") && p.includes('"../lib/a"'))).toBe(true);
      expect(problems.some((p) => p.startsWith("lib/b.ts") && p.includes('"./a"'))).toBe(true);
      expect(problems.some((p) => p.startsWith("api/ok.ts"))).toBe(false); // .js import + type-only import are fine
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
