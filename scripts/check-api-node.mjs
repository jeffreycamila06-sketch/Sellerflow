// Vercel functions (api/*.ts) run in PLAIN NODE as ES modules ("type": "module"). Node needs the
// file extension on every relative import — "../src/website/og" fails at runtime with
// ERR_MODULE_NOT_FOUND (production 500 on /s/<sub>, 2026-11-15), while Vite / Vitest resolve it
// fine, so no test saw it. This check does what Vercel does and then loads the result in Node:
//   1. every relative import in api/*.ts and in every file they reach must end in ".js";
//   2. each file is compiled on its own (TypeScript transpileModule, like Vercel's per-file
//      compile, NO bundler) into a temp folder with {"type":"module"};
//   3. node imports each api/*.js and checks its default export is a function;
//   4. api/shop.js is run once with a fake request (fetch stubbed) and must answer 200 with the
//      shop's tags in the page.
// Run: node scripts/check-api-node.mjs   (CI runs it; a vitest test runs it too)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every static / dynamic / re-export module specifier in a source text. Type-only imports are
 *  erased by the compiler, so they are skipped. */
export function moduleSpecifiers(src) {
  const out = [];
  const re = /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[4]) { out.push(m[4]); continue; }
    if (m[2]) continue; // import type … / export type …
    out.push(m[3]);
  }
  return out;
}
/** The relative specifiers Node cannot load: no extension, or a ".ts" extension. */
export function badRelativeImports(src) {
  return moduleSpecifiers(src).filter((s) => (s.startsWith("./") || s.startsWith("../")) && !/\.(m?js|json)$/.test(s));
}

function sourceOf(fromFile, spec) {
  const target = resolve(dirname(fromFile), spec);
  if (/\.m?js$/.test(target)) {
    const tsFile = target.replace(/\.m?js$/, ".ts");
    if (existsSync(tsFile)) return tsFile;
  }
  return target;
}

export function checkApi({ root = ROOT, log = console.log } = {}) {
  const apiDir = join(root, "api");
  const entries = readdirSync(apiDir).filter((f) => /\.(ts|m?js)$/.test(f) && !f.endsWith(".d.ts")).map((f) => join(apiDir, f));
  const problems = [];
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { problems.push(`${relative(root, file)}: imported but missing`); continue; }
    const src = readFileSync(file, "utf8");
    for (const s of badRelativeImports(src)) problems.push(`${relative(root, file)}: relative import "${s}" has no .js extension (Node ESM cannot load it)`);
    for (const s of moduleSpecifiers(src)) if (s.startsWith("./") || s.startsWith("../")) queue.push(sourceOf(file, s));
  }
  return { entries, files: [...seen], problems };
}

async function loadInNode(root, files, entries, log) {
  const out = mkdtempSync(join(tmpdir(), "sfl-api-node-"));
  try {
    writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
    for (const f of files) {
      const rel = relative(root, f).replace(/\.ts$/, ".js");
      const dest = join(out, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const src = readFileSync(f, "utf8");
      const js = f.endsWith(".ts")
        ? ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } }).outputText
        : src;
      writeFileSync(dest, js);
    }
    const loaded = {};
    for (const e of entries) {
      const rel = relative(root, e).replace(/\.ts$/, ".js");
      const mod = await import(pathToFileURL(join(out, rel)).href);
      if (typeof mod.default !== "function") throw new Error(`${rel}: default export is not a function`);
      loaded[rel] = mod.default;
      log(`  loaded in Node: ${rel}`);
    }
    // Run the shop page once, the way Vercel calls it.
    const shop = loaded["api/shop.js"];
    if (shop) {
      const realFetch = globalThis.fetch;
      process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co";
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= "test-key";
      globalThis.fetch = async (u) => {
        const url = String(u);
        if (url.endsWith("/shop.html")) return new Response('<html><head><title>x</title><!--sfl-og--></head><body><div id="shop-root"></div></body></html>');
        if (url.includes("/rpc/website_og")) return new Response(JSON.stringify({ online: true, title: "Test Shop", description: "Hi" }), { headers: { "content-type": "application/json" } });
        return new Response("", { status: 404 });
      };
      let status = 0; let body = "";
      try {
        await shop({ query: { sub: "testshop" }, headers: { host: "www.sellerflowlive.com" } }, {
          setHeader: () => {},
          status: (n) => ({ send: (b) => { status = n; body = b; } }),
        });
      } finally { globalThis.fetch = realFetch; }
      if (status !== 200 || !body.includes('og:title" content="Test Shop"')) throw new Error(`api/shop.js answered ${status} without the shop tags`);
      log("  ran in Node: api/shop.js → 200 with the shop's tags");
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entries, files, problems } = checkApi();
  if (problems.length) {
    console.error("api/ check FAILED:\n" + problems.map((p) => "  " + p).join("\n"));
    process.exit(1);
  }
  console.log(`api/ imports OK (${files.length} file(s))`);
  try { await loadInNode(ROOT, files, entries, console.log); }
  catch (e) { console.error("api/ check FAILED (Node load): " + (e && e.message ? e.message : e)); process.exit(1); }
  console.log("api/ check passed");
}
