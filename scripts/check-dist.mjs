// Build 10 — checks the production build in dist/ (run after `npm run build`; CI runs it).
// Fails (exit 1) when:
//   • a source map ships (*.map) or any .js/.css/.html still points to one (sourceMappingURL);
//   • the old app page (app.html) is in the build;
//   • a dev-only log message (a string passed to log.* / devLog.* in src) reached the bundle;
//   • the start banner is missing, or the marker label (the i18n key below) is missing.
// Usage: node scripts/check-dist.mjs [distDir] [srcDir]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER_KEY = "rd_ps_fw_channel";
export const BANNER_START = "Walang makukuha dito.";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

// The first string literal of every log.x("...") / devLog.x("...") call in the app source.
export function devLogMessages(srcDir) {
  const out = new Set();
  for (const f of walk(srcDir)) {
    if (!/\.(ts|tsx)$/.test(f) || f.includes("__tests__") || f.endsWith(join("lib", "log.ts"))) continue;
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/\b(?:log|devLog)\.(?:log|info|warn|error|debug)\(\s*(["'`])((?:\\.|(?!\1).)*?)\1/g)) {
      const lit = m[2].split("${")[0];           // a template literal: the part before the first ${
      if (lit.trim().length >= 10) out.add(lit);
    }
  }
  return [...out];
}

// The marker label's English value, read from the i18n source (so the value lives in one place).
export function markerValue(srcDir) {
  const s = readFileSync(join(srcDir, "redesign", "i18n", "index.tsx"), "utf8");
  const m = new RegExp(`^\\s*${MARKER_KEY}: \\{ en: "([^"]+)"`, "m").exec(s);
  return m ? m[1] : "";
}

export function checkDist(distDir, srcDir) {
  const errors = [];
  if (!existsSync(distDir)) return [`no ${distDir} — run npm run build first`];
  const files = walk(distDir);
  const text = files.filter((f) => [".js", ".css", ".html", ".mjs"].includes(extname(f)));
  for (const f of files) if (extname(f) === ".map") errors.push(`source map shipped: ${f}`);
  if (existsSync(join(distDir, "app.html"))) errors.push("app.html is in the build");
  const bodies = text.map((f) => [f, readFileSync(f, "utf8")]);
  for (const [f, b] of bodies) if (b.includes("sourceMappingURL")) errors.push(`sourceMappingURL in ${f}`);
  const js = bodies.filter(([f]) => f.endsWith(".js")).map(([, b]) => b).join("\n");
  for (const msg of devLogMessages(srcDir)) if (js.includes(msg)) errors.push(`dev log message in the bundle: "${msg.slice(0, 60)}"`);
  const marker = markerValue(srcDir);
  if (!marker) errors.push(`marker key ${MARKER_KEY} not found in the i18n source`);
  else if (!js.includes(marker)) errors.push("marker label missing from the bundle");
  if (!js.includes(BANNER_START)) errors.push("start banner missing from the bundle");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] || "dist");
  const src = resolve(process.argv[3] || "src");
  const errors = checkDist(dist, src);
  if (errors.length) {
    for (const e of errors) console.error(`check-dist: ${e}`);
    process.exit(1);
  }
  console.log(`check-dist: ok (${devLogMessages(src).length} dev log messages absent, no source maps, marker + banner present)`);
}
