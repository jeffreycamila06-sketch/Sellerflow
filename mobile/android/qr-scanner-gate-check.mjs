// Printer-safety gate for the native "Scan sticker QR" (Android versionCode 11) — the CHECKS.
// mobile/android/qr-scanner-gate.sh builds main and this branch and calls this file with what it built.
// Jeff's rule: the only change allowed is that the QR gets read — no printer, no other function changes.
// It prints PASS / FAIL for:
//   a) chip types (ABI folders) in the new .aab = exactly main's
//   b) every native library (.so) of main is in the new .aab with the SAME sha256 (each one listed)
//   c) the printer libraries (the files in app/libs) are the same files, and every class the printer code
//      can reach (their classes + SellerFlowPrinterPlugin and everything it uses, transitively) is the same
//      code in both dex builds (dexdump, normalized: file offsets / index numbers / source line numbers
//      removed — those change when other classes are added, the code does not). MainActivity may differ
//      ONLY by the one registration line in onCreate.
//   d) every library on main's releaseRuntimeClasspath keeps the SAME version (old → new listed)
//   e) the merged manifest: no new permission / feature, no new component except CameraX / ML Kit ones
//      (listed with where they come from), nothing existing changed (Bluetooth / printer included)
//   f) per-phone download growth ≤ max MB; every NEW .so has 16 KB-aligned load segments
// Any FAIL → "STOP — do not release" + the reasons. Exit 0 = PASS, 1 = FAIL, 2 = could not measure.
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ── zip (.aab / .aar / .jar) ────────────────────────────────────────────────────────────────
/** Read a zip into Map<name, () => Buffer> (stored + deflate). */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    out.set(name, () => {
      const ln = buf.readUInt16LE(lho + 26), lx = buf.readUInt16LE(lho + 28);
      const data = buf.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip method ${method} not supported (${name})`);
    });
  }
  return out;
}

// ── a) chip types · b) native libraries · f) 16 KB ──────────────────────────────────────────
const LIB_RE = /^base\/lib\/([^/]+)\/([^/]+\.so)$/;
/** Map<"abi/name.so", {abi, hash, bytes}> from an .aab's zip map. */
export function nativeLibs(zip) {
  const m = new Map();
  for (const [name, get] of zip) {
    const r = LIB_RE.exec(name);
    if (!r) continue;
    const bytes = get();
    m.set(`${r[1]}/${r[2]}`, { abi: r[1], hash: sha(bytes), bytes });
  }
  return m;
}
export const abisOf = (libs) => [...new Set([...libs.values()].map((l) => l.abi))].sort();

export function checkAbis(mainAbis, newAbis) {
  const same = mainAbis.length === newAbis.length && mainAbis.every((a, i) => a === newAbis[i]);
  return { ok: same, lines: [`${same ? "PASS" : "FAIL"} a) chip types: main [${mainAbis.join(", ")}] · new [${newAbis.join(", ")}]`] };
}

export function checkSoHashes(mainLibs, newLibs) {
  const lines = [], bad = [];
  for (const [k, m] of [...mainLibs].sort()) {
    const n = newLibs.get(k);
    if (!n) { bad.push(`${k} missing`); lines.push(`  MISSING ${k} (main ${m.hash})`); continue; }
    const same = n.hash === m.hash;
    if (!same) bad.push(`${k} changed`);
    lines.push(`  ${same ? "same   " : "CHANGED"} ${k} ${m.hash}${same ? "" : ` → ${n.hash}`}`);
  }
  const added = [...newLibs.keys()].filter((k) => !mainLibs.has(k)).sort();
  for (const k of added) lines.push(`  new     ${k} ${newLibs.get(k).hash}`);
  return { ok: bad.length === 0, bad, added, lines: [`${bad.length ? "FAIL" : "PASS"} b) native libraries of main: ${mainLibs.size - bad.length}/${mainLibs.size} identical (sha256)${bad.length ? ` — ${bad.join(", ")}` : ""}`, ...lines] };
}

/** Smallest PT_LOAD alignment of an ELF file, or null if it is not ELF. */
export function elfLoadAlign(data) {
  if (data.length < 64 || data.readUInt32BE(0) !== 0x7f454c46) return null;
  const is64 = data[4] === 2, le = data[5] === 1;
  const u16 = (o) => (le ? data.readUInt16LE(o) : data.readUInt16BE(o));
  const u32 = (o) => (le ? data.readUInt32LE(o) : data.readUInt32BE(o));
  const u64 = (o) => Number(le ? data.readBigUInt64LE(o) : data.readBigUInt64BE(o));
  const phoff = is64 ? u64(0x20) : u32(0x1c);
  const [phentsize, phnum] = is64 ? [u16(0x36), u16(0x38)] : [u16(0x2a), u16(0x2c)];
  let min = Infinity;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (u32(o) !== 1) continue; // PT_LOAD
    min = Math.min(min, is64 ? u64(o + 0x30) : u32(o + 0x1c));
  }
  return { is64, align: Number.isFinite(min) ? min : 0 };
}

export function checkNewSoAlignment(newLibs, added) {
  const lines = [], bad = [];
  for (const k of added) {
    const e = elfLoadAlign(newLibs.get(k).bytes);
    if (!e) { lines.push(`  ${k}: not an ELF file`); bad.push(k); continue; }
    const ok = !e.is64 || e.align >= 16384;
    if (!ok) bad.push(k);
    lines.push(`  ${ok ? "ok " : "BAD"} ${k} (${e.is64 ? "64-bit" : "32-bit"}, align ${e.align})`);
  }
  return { ok: bad.length === 0, lines: [`${bad.length ? "FAIL" : "PASS"} f) 16 KB pages: ${added.length} new native librar${added.length === 1 ? "y" : "ies"}${bad.length ? `, not aligned: ${bad.join(", ")}` : ", every 64-bit one aligned"}`, ...lines] };
}

/** bundletool `get-size total --dimensions=ABI` CSV → Map<abi, maxBytes>. */
export function parseSizeCsv(text) {
  const rows = String(text).trim().split(/\r?\n/).map((l) => l.split(","));
  const head = rows.shift() || [];
  const ia = head.indexOf("ABI"), im = head.indexOf("MAX");
  const m = new Map();
  for (const r of rows) m.set(ia >= 0 ? r[ia] : "all", Number(r[im]));
  return m;
}
export function checkSize({ mainCsv, newCsv, mainAab, newAab, maxMb }) {
  if (mainCsv && newCsv) {
    const b = parseSizeCsv(mainCsv), a = parseSizeCsv(newCsv);
    let worst = 0; const parts = [];
    for (const [abi, v] of [...a].sort()) {
      const grow = (v - (b.get(abi) || 0)) / 1e6;
      worst = Math.max(worst, grow);
      parts.push(`${abi}: ${((b.get(abi) || 0) / 1e6).toFixed(1)} → ${(v / 1e6).toFixed(1)} MB (+${grow.toFixed(1)})`);
    }
    const ok = worst <= maxMb;
    return { ok, lines: [`${ok ? "PASS" : "FAIL"} f) size: per-phone download +${worst.toFixed(1)} MB at most (limit ${maxMb} MB) — ${parts.join("; ")}`] };
  }
  const grow = (newAab - mainAab) / 1e6;
  const ok = grow <= maxMb;
  return { ok, lines: [`${ok ? "PASS" : "FAIL"} f) size: .aab ${(mainAab / 1e6).toFixed(1)} → ${(newAab / 1e6).toFixed(1)} MB (+${grow.toFixed(1)}, limit ${maxMb} MB; install bundletool for the per-phone sizes)`] };
}

// ── c) printer code in the dex ──────────────────────────────────────────────────────────────
/**
 * dexdump -d output → Map<descriptor, {text, refs:Set}>. Normalized so that a class whose code did not
 * change reads the same in both builds: file offsets, dex index numbers (string@ / method@ / type@ / field@)
 * and source line numbers / local variable tables are removed — those move when OTHER classes are added.
 */
export function parseDexdump(text) {
  const classes = new Map();
  let cur = null, lines = [], skipDebug = false;
  const flush = () => {
    if (!cur) return;
    const t = lines.join("\n");
    const refs = new Set(t.match(/L[A-Za-z0-9_$/\-]+;/g) || []);
    refs.delete(cur);
    const prev = classes.get(cur);
    classes.set(cur, prev ? { text: prev.text + "\n" + t, refs: new Set([...prev.refs, ...refs]) } : { text: t, refs });
  };
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^Class #\d+\s+-/.test(raw)) { flush(); cur = null; lines = []; skipDebug = false; continue; }
    if (/^Class #\d+ header:/.test(raw) || /^(Processing|Opened|DEX file header)/.test(raw)) { flush(); cur = null; lines = []; continue; }
    const d = /^\s*Class descriptor\s*:\s*'([^']+)'/.exec(raw);
    if (d) { cur = d[1]; lines.push(`class ${cur}`); continue; }
    if (!cur) continue;
    let line = raw;
    // debug tables: "positions :" (source line numbers) and "locals :" end at the next "key : value" line
    if (/^\s*(positions|locals)\s*:/.test(line)) { skipDebug = true; continue; }
    if (skipDebug) {
      if (/^\s+0x[0-9a-f]+ (line=|-)/.test(line) || /^\s*$/.test(line)) continue;
      skipDebug = false;
    }
    if (/^\s*(method_idx|field_idx|class_idx|superclass_idx|interfaces_off|annotations_off|class_data_off)\b/.test(line)) continue;
    line = line.replace(/^\s*source_file_idx\s*:\s*\d+\s*/, "source_file ");
    // code lines "000154: 7010 0300 …  |0000: invoke-direct …" → only the instruction after "|"
    const bar = /^[0-9a-f]{6}:[^|]*\|(.*)$/.exec(line);
    if (bar) line = bar[1];
    line = line.replace(/\[[0-9a-f]{6,8}\]\s*/g, "").replace(/\s*\/\/ (?:string|type|method|field|proto|call_site|method_handle)@[0-9a-f]+/g, "");
    lines.push(line.trimEnd());
  }
  flush();
  return classes;
}

export const isRClass = (d) => /\/R;$|\/R\$[^/]*;$/.test(d);

/** Every class (in main's dex) the printer code can reach: roots + their references, transitively. R excluded. */
export function printerClosure(mainClasses, roots) {
  const seen = new Set(), todo = [...roots].filter((d) => mainClasses.has(d));
  while (todo.length) {
    const d = todo.pop();
    if (seen.has(d) || isRClass(d)) continue;
    seen.add(d);
    for (const r of mainClasses.get(d).refs) if (mainClasses.has(r) && !seen.has(r)) todo.push(r);
  }
  return seen;
}

const MAIN_ACTIVITY = "Lcom/sellerflow/live/MainActivity;";
const REG_LINES = [/^const-class v\d+, Lcom\/sellerflow\/live\/SellerFlowScannerPlugin;$/, /^invoke-virtual \{v\d+, v\d+\}, Lcom\/sellerflow\/live\/MainActivity;\.registerPlugin:\(Ljava\/lang\/Class;\)V$/];
/** MainActivity may differ only by the scanner registration in onCreate (const-class + registerPlugin). */
export function mainActivityOnlyRegistration(mainText, newText) {
  // instruction addresses, branch targets and catch ranges move when two instructions are added
  const norm = (t) => t.split("\n")
    .map((l) => l.replace(/^[0-9a-f]{4,8}: /, "").replace(/ \/\/ [+-][0-9a-f]+$/, ""))
    .map((l) => (/^(if-[a-z]+|goto|packed-switch|sparse-switch|fill-array-data)\b/.test(l) ? l.replace(/,? [0-9a-f]{4,8}$/, "") : l))
    .map((l) => l.replace(/0x[0-9a-f]{4,8}/g, "0x?"))
    .filter((l) => !/^\s*insns size\s*:/.test(l) && !/^\s*(registers|outs)\s*:/.test(l));
  const a = norm(mainText), b = norm(newText);
  const extra = [];
  let i = 0;
  for (const line of b) {
    if (i < a.length && line === a[i]) { i++; continue; }
    extra.push(line);
  }
  if (i !== a.length) return false; // something of main is missing
  return extra.length === 2 && REG_LINES[0].test(extra[0].trim()) && REG_LINES[1].test(extra[1].trim());
}

export function checkPrinterClasses({ mainClasses, newClasses, libClassDescs, appRoots, libFiles }) {
  const lines = [], bad = [];
  // the printer library FILES themselves
  for (const f of libFiles) {
    const ok = f.mainHash === f.newHash;
    if (!ok) bad.push(`${f.name} file changed`);
    lines.push(`  ${ok ? "same   " : "CHANGED"} libs/${f.name} ${f.mainHash}${ok ? "" : ` → ${f.newHash}`}`);
  }
  const libInDex = [...libClassDescs].filter((d) => mainClasses.has(d));
  const closure = printerClosure(mainClasses, [...libInDex, ...appRoots]);
  let same = 0;
  const changed = [];
  for (const d of [...closure].sort()) {
    const m = mainClasses.get(d), n = newClasses.get(d);
    if (!n) { changed.push(`${d} missing`); continue; }
    if (m.text === n.text) { same++; continue; }
    if (d === MAIN_ACTIVITY && mainActivityOnlyRegistration(m.text, n.text)) { lines.push(`  MainActivity: identical except the one added line registerPlugin(SellerFlowScannerPlugin.class) in onCreate`); same++; continue; }
    changed.push(`${d} changed`);
  }
  bad.push(...changed);
  const appCount = [...closure].filter((d) => d.startsWith("Lcom/sellerflow/live/")).length;
  lines.unshift(`  ${closure.size} classes reached by the printer code (${libInDex.length} from the printer libraries, ${appCount} of our own, the rest from Capacitor / androidx / Java libraries they use) — ${same} identical`);
  for (const c of changed.slice(0, 40)) lines.push(`  CHANGED ${c}`);
  if (changed.length > 40) lines.push(`  … and ${changed.length - 40} more`);
  return { ok: bad.length === 0 && closure.size > 0, closure, lines: [`${bad.length || !closure.size ? "FAIL" : "PASS"} c) printer code: ${bad.length ? bad.length + " difference(s)" : closure.size ? "the same in both builds" : "no printer classes found"}`, ...lines] };
}

/** Class descriptors inside an .aar (its classes.jar + libs/*.jar) or a .jar. */
export function libClassDescriptors(name, buf) {
  const out = new Set();
  const fromJar = (jar) => { for (const n of readZip(jar).keys()) if (n.endsWith(".class") && !n.startsWith("META-INF/")) out.add(`L${n.slice(0, -6)};`); };
  if (name.endsWith(".jar")) fromJar(buf);
  else for (const [n, get] of readZip(buf)) if (n === "classes.jar" || /^libs\/.*\.jar$/.test(n)) fromJar(get());
  return out;
}

// ── d) libraries and their versions ─────────────────────────────────────────────────────────
/** `gradlew :app:dependencies --configuration releaseRuntimeClasspath` → Map<group:artifact, version>. */
export function parseGradleDeps(text) {
  const m = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    if (!/^[| ]*[+\\]--- /.test(raw)) continue;
    let s = raw.replace(/^[| ]*[+\\]--- /, "").replace(/\{strictly ([^}]+)\}/g, "$1").trim();
    if (s.startsWith("project ")) continue;
    const flag = /\((\*|c|n)\)$/.exec(s);
    if (flag && flag[1] !== "*") continue;
    s = s.replace(/\s*\((\*|c|n)\)$/, "");
    const r = /^([^:\s]+):([^:\s]+)(?::([^\s]+))?(?:\s+->\s+([^\s]+))?$/.exec(s);
    if (!r) continue;
    let v = r[4] || r[3];
    if (!v || v.startsWith("project")) continue;
    if (v.includes(":")) v = v.split(":").pop();
    m.set(`${r[1]}:${r[2]}`, v);
  }
  return m;
}
export function checkDeps(mainDeps, newDeps) {
  const bumped = [], gone = [];
  for (const [k, v] of [...mainDeps].sort()) {
    const n = newDeps.get(k);
    if (!n) gone.push(`${k} ${v} → (gone)`);
    else if (n !== v) bumped.push(`${k} ${v} → ${n}`);
  }
  const added = [...newDeps].filter(([k]) => !mainDeps.has(k)).map(([k, v]) => `${k}:${v}`).sort();
  const ok = !bumped.length && !gone.length && mainDeps.size > 0;
  return { ok, lines: [
    `${ok ? "PASS" : "FAIL"} d) libraries: ${mainDeps.size} on main — ${bumped.length} version change(s), ${gone.length} removed${mainDeps.size ? "" : " (none read — the dependency list is empty)"}`,
    ...bumped.map((x) => `  CHANGED ${x}`), ...gone.map((x) => `  REMOVED ${x}`),
    `  ${added.length} new (CameraX / ML Kit and what they bring): ${added.join(", ") || "none"}`,
  ] };
}

// ── e) merged manifest ──────────────────────────────────────────────────────────────────────
const attrsOf = (s) => [...s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`).sort().join(" ");
/** Merged AndroidManifest.xml → {perms, features, components, app, sdk} (Maps name → attribute string). */
export function parseManifest(xml) {
  const x = String(xml).replace(/<!--[\s\S]*?-->/g, "");
  const out = { perms: new Map(), features: new Map(), components: new Map(), metas: new Map(), queries: new Map(), app: "", sdk: "" };
  for (const m of x.matchAll(/<uses-permission(?:-sdk-23)?\b([^>]*)>/g)) { const n = /android:name="([^"]+)"/.exec(m[1]); if (n) out.perms.set(n[1], attrsOf(m[1])); }
  for (const m of x.matchAll(/<uses-feature\b([^>]*)>/g)) { const n = /android:name="([^"]+)"/.exec(m[1]); if (n) out.features.set(n[1], attrsOf(m[1])); }
  for (const m of x.matchAll(/<(activity|activity-alias|service|receiver|provider)\b([^>]*)>/g)) { const n = /android:name="([^"]+)"/.exec(m[2]); if (n) out.components.set(`${m[1]} ${n[1]}`, attrsOf(m[2])); }
  for (const m of x.matchAll(/<meta-data\b([^>]*)>/g)) { const n = /android:name="([^"]+)"/.exec(m[1]); if (n) out.metas.set(n[1], attrsOf(m[1])); }
  for (const m of x.matchAll(/<package\b([^>]*)>/g)) { const n = /android:name="([^"]+)"/.exec(m[1]); if (n) out.queries.set(n[1], attrsOf(m[1])); }
  const app = /<application\b([^>]*)>/.exec(x); out.app = app ? attrsOf(app[1]) : "";
  const sdk = /<uses-sdk\b([^>]*)>/.exec(x); out.sdk = sdk ? attrsOf(sdk[1]) : "";
  return out;
}
/** manifest-merger blame report → Map<"tag name", "group:artifact"> (who added each element). */
export function parseBlame(text) {
  const lines = String(text).split(/\r?\n/), byNo = new Map(), origin = new Map();
  for (const l of lines) {
    const c = /^(\d+)-->(.*)$/.exec(l);
    if (c) { if (!origin.has(c[1])) origin.set(c[1], c[2]); continue; }
    const t = /^(\d+)(.*)$/.exec(l);
    if (t) byNo.set(t[1], t[2]);
  }
  const out = new Map();
  for (const [no, content] of byNo) {
    const tag = /<(uses-permission|uses-feature|activity|activity-alias|service|receiver|provider|meta-data|package)\b/.exec(content);
    if (!tag) continue;
    let name = /android:name="([^"]+)"/.exec(content);
    if (!name) { // the name may be on the next line
      const next = byNo.get(String(Number(no) + 1)) || "";
      name = /android:name="([^"]+)"/.exec(next);
    }
    if (!name) continue;
    const o = origin.get(no) || "";
    const lib = /\[([^\]:]+):([^\]:]+):[^\]]*\]/.exec(o);
    const key = /^(uses-|meta-data|package)/.test(tag[1]) ? name[1] : `${tag[1]} ${name[1]}`;
    out.set(key, lib ? `${lib[1]}:${lib[2]}` : o.includes("src/main/AndroidManifest.xml") ? "app" : "unknown");
  }
  return out;
}
const SCANNER_ORIGINS = /^(androidx\.camera|com\.google\.mlkit|com\.google\.android\.gms|com\.google\.android\.datatransport|com\.google\.firebase):/;
const SCANNER_NAMES = /^(activity|activity-alias|service|receiver|provider) (androidx\.camera\.|com\.google\.mlkit\.|com\.google\.android\.gms\.|com\.google\.android\.datatransport\.|com\.google\.firebase\.)/;
const PRINTER_WORDS = /bluetooth|location|nearby|printer|niimbot|ble/i;
export function checkManifest(mainXml, newXml, blameText) {
  const a = parseManifest(mainXml), b = parseManifest(newXml);
  const blame = blameText ? parseBlame(blameText) : new Map();
  const fails = [], lines = [], allowed = [];
  const cmp = (kind, ma, mb) => {
    for (const [k, v] of ma) {
      if (!mb.has(k)) fails.push(`${kind} removed: ${k}${PRINTER_WORDS.test(k) ? " (printer / Bluetooth)" : ""}`);
      else if (mb.get(k) !== v) fails.push(`${kind} changed: ${k}${PRINTER_WORDS.test(k) ? " (printer / Bluetooth)" : ""} [${v}] → [${mb.get(k)}]`);
    }
  };
  cmp("permission", a.perms, b.perms);
  cmp("feature", a.features, b.features);
  cmp("component", a.components, b.components);
  cmp("meta-data", a.metas, b.metas);
  cmp("query package", a.queries, b.queries);
  for (const k of b.perms.keys()) if (!a.perms.has(k)) fails.push(`NEW permission ${k} (from ${blame.get(k) || "?"})`);
  for (const k of b.features.keys()) if (!a.features.has(k)) fails.push(`NEW feature ${k} (from ${blame.get(k) || "?"})`);
  // a new component / meta-data / query package is allowed only when CameraX / ML Kit (or the Google
  // libraries ML Kit brings) put it there: the merge report says who; without one, its name must say so
  const fromScanner = (k, nameKey) => {
    const from = blame.get(k) || "";
    if (from && from !== "unknown") return { ok: SCANNER_ORIGINS.test(from), from };
    return { ok: SCANNER_NAMES.test(nameKey), from: "name only — no merge report line" };
  };
  for (const k of b.components.keys()) {
    if (a.components.has(k)) continue;
    const f = fromScanner(k, k);
    if (f.ok && !PRINTER_WORDS.test(k)) allowed.push(`${k} (from ${f.from})`);
    else fails.push(`NEW ${k} (from ${f.from || "?"}) — not a CameraX / ML Kit part`);
  }
  for (const [kind, ma, mb] of [["meta-data", a.metas, b.metas], ["query package", a.queries, b.queries]]) {
    for (const k of mb.keys()) {
      if (ma.has(k)) continue;
      const f = fromScanner(k, `service ${k}`);
      if (f.ok && !PRINTER_WORDS.test(k)) allowed.push(`${kind} ${k} (from ${f.from})`);
      else fails.push(`NEW ${kind} ${k} (from ${f.from || "?"}) — not a CameraX / ML Kit part`);
    }
  }
  if (a.app !== b.app) fails.push(`application settings changed [${a.app}] → [${b.app}]`);
  if (a.sdk !== b.sdk) fails.push(`minSdk / targetSdk changed [${a.sdk}] → [${b.sdk}]`);
  const bt = [...b.perms.keys()].filter((k) => PRINTER_WORDS.test(k)).sort();
  lines.push(`  Bluetooth / location permissions (same as main): ${bt.join(", ") || "none"}`);
  lines.push(`  new CameraX / ML Kit parts (allowed): ${allowed.length ? "" : "none"}`, ...allowed.map((x) => `    ${x}`));
  for (const f of fails) lines.push(`  FAIL ${f}`);
  return { ok: fails.length === 0, lines: [`${fails.length ? "FAIL" : "PASS"} e) manifest: ${fails.length ? fails.length + " problem(s)" : `no new permission or feature, nothing existing changed, ${allowed.length} new CameraX / ML Kit part(s)`}`, ...lines] };
}

// ── the whole gate ──────────────────────────────────────────────────────────────────────────
/** Every check from ready inputs (the CLI below reads them from disk; tests pass made-up ones). */
export function runGate(i) {
  const out = [];
  const mainLibs = nativeLibs(i.mainZip), newLibs = nativeLibs(i.newZip);
  const parts = [
    checkAbis(abisOf(mainLibs), abisOf(newLibs)),
  ];
  const so = checkSoHashes(mainLibs, newLibs);
  parts.push(so);
  parts.push(checkPrinterClasses(i.dex));
  parts.push(checkDeps(parseGradleDeps(i.mainDeps), parseGradleDeps(i.newDeps)));
  parts.push(checkManifest(i.mainManifest, i.newManifest, i.newBlame));
  parts.push(checkSize({ mainCsv: i.mainSizeCsv, newCsv: i.newSizeCsv, mainAab: i.mainAabBytes, newAab: i.newAabBytes, maxMb: i.maxMb }));
  parts.push(checkNewSoAlignment(newLibs, so.added));
  for (const p of parts) out.push(...p.lines, "");
  const failed = parts.filter((p) => !p.ok).map((p) => p.lines[0].replace(/^FAIL /, ""));
  out.push(failed.length ? `STOP — do not release. ${failed.length} check(s) failed:` : "RESULT: PASS — the printer code and everything it uses is the same as main; only the scanner was added.");
  for (const f of failed) out.push(`  - ${f}`);
  return { pass: failed.length === 0, lines: out };
}

/** Run dexdump on every classes*.dex of an .aab → one text. */
export function dexdumpAab(zip, dexdump) {
  const dir = mkdtempSync(join(tmpdir(), "sfl-dex-"));
  try {
    let text = "";
    for (const [name, get] of zip) {
      if (!/^base\/dex\/classes\d*\.dex$/.test(name)) continue;
      const f = join(dir, basename(name));
      writeFileSync(f, get());
      const r = spawnSync(dexdump, ["-d", f], { maxBuffer: 2 * 1024 * 1024 * 1024, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`dexdump failed on ${name}: ${(r.stderr || "").slice(0, 200)}`);
      text += r.stdout + "\n";
    }
    if (!text) throw new Error("no classes*.dex in the .aab");
    return text;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const PRINTER_LIBS = ["4.1.1-release.aar", "image-1.9.5.aar", "LPAPI-2019-11-20-R.jar"];
const APP_PRINTER_ROOTS = /^Lcom\/sellerflow\/live\/(SellerFlowPrinterPlugin|MainActivity)(\$[^;]*)?;$/;

function cli(argv) {
  const a = {};
  for (let k = 0; k < argv.length; k += 2) a[argv[k].replace(/^--/, "")] = argv[k + 1];
  const need = ["main-aab", "new-aab", "main-deps", "new-deps", "main-manifest", "new-manifest", "main-libs", "new-libs", "dexdump"];
  for (const n of need) if (!a[n] || !existsSync(a[n])) { console.log(`CANNOT MEASURE: --${n} missing (${a[n] || "not given"})`); return 2; }
  const mainBuf = readFileSync(a["main-aab"]), newBuf = readFileSync(a["new-aab"]);
  const mainZip = readZip(mainBuf), newZip = readZip(newBuf);
  const libFiles = [], libClassDescs = new Set();
  for (const n of PRINTER_LIBS) {
    const pm = join(a["main-libs"], n), pn = join(a["new-libs"], n);
    if (!existsSync(pm) || !existsSync(pn)) { console.log(`CANNOT MEASURE: printer library ${n} missing`); return 2; }
    const bm = readFileSync(pm), bn = readFileSync(pn);
    for (const [side, b] of [["main", bm], ["new", bn]]) {
      if (b.subarray(0, 40).toString().startsWith("version https://git-lfs")) { console.log(`CANNOT MEASURE: ${n} is a Git LFS pointer in the ${side} build — run "git lfs pull" in that checkout`); return 2; }
    }
    libFiles.push({ name: n, mainHash: sha(bm), newHash: sha(bn) });
    for (const d of libClassDescriptors(n, bm)) libClassDescs.add(d);
  }
  console.log("reading the dex of both builds (dexdump)…");
  const mainClasses = parseDexdump(dexdumpAab(mainZip, a.dexdump));
  const newClasses = parseDexdump(dexdumpAab(newZip, a.dexdump));
  const appRoots = [...mainClasses.keys()].filter((d) => APP_PRINTER_ROOTS.test(d));
  const read = (k) => (a[k] && existsSync(a[k]) ? readFileSync(a[k], "utf8") : "");
  const r = runGate({
    mainZip, newZip, mainAabBytes: mainBuf.length, newAabBytes: newBuf.length,
    dex: { mainClasses, newClasses, libClassDescs, appRoots, libFiles },
    mainDeps: read("main-deps"), newDeps: read("new-deps"),
    mainManifest: read("main-manifest"), newManifest: read("new-manifest"), newBlame: read("new-blame"),
    mainSizeCsv: read("main-size"), newSizeCsv: read("new-size"), maxMb: Number(a["max-mb"] || 6),
  });
  console.log(r.lines.join("\n"));
  return r.pass ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let code = 2;
  try { code = cli(process.argv.slice(2)); } catch (e) { console.log(`CANNOT MEASURE: ${e && e.message}`); code = 2; }
  process.exit(code);
}
