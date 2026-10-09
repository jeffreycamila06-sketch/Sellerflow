// Build 10b — the folder Chrome loads: chrome-extension/ (readable sources) →
// chrome-extension-dist/ (minified .js, no comments; manifest, popup page and README copied).
// Behaviour is unchanged: top-level names are kept, files are not bundled or wrapped.
// Usage: node scripts/build-extension.mjs [srcDir] [outDir]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { minifySync } from "rolldown/experimental";

export function buildExtension(srcDir, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const done = [];
  for (const name of readdirSync(srcDir)) {
    const from = join(srcDir, name);
    if (statSync(from).isDirectory()) continue;
    let body = readFileSync(from, "utf8");
    if (extname(name) === ".js") {
      const r = minifySync(name, body, { compress: true, mangle: true });
      if (r.errors && r.errors.length) throw new Error(`minify ${name}: ${r.errors.map((e) => e.message).join("; ")}`);
      body = r.code;
    } else if (extname(name) === ".html") {
      body = body.replace(/<!--[\s\S]*?-->/g, "");
    }
    writeFileSync(join(outDir, name), body);
    done.push(name);
  }
  return done;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = resolve(process.argv[2] || "chrome-extension");
  const out = resolve(process.argv[3] || "chrome-extension-dist");
  const files = buildExtension(src, out);
  console.log(`build-extension: ${files.length} files → ${out}`);
}
