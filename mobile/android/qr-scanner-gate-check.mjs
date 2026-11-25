// Printer-safety gate for the native "Scan sticker QR" (Android versionCode 11) — the CHECKS.
// mobile/android/qr-scanner-gate.sh builds the base (the newest main commit WITHOUT the scanner) and the
// commit to upload, and calls this file with what it built. Jeff's rule: the only change allowed is that the
// QR gets read — no printer, no other function changes. It prints PASS / FAIL for:
//   a) chip types (ABI folders) in the new .aab = exactly the base's
//   b) every native library (.so) of the base is in the new .aab with the SAME sha256 (each one listed)
//   c) the printer libraries (the files in app/libs) are the same files, and every class the printer code
//      can reach (their classes + SellerFlowPrinterPlugin and everything it uses, transitively) is the same
//      code in both dex builds (dexdump -d -a: code AND annotations such as @PluginMethod / @CapacitorPlugin;
//      file offsets / index numbers / source line numbers removed — those change when other classes are
//      added, the code does not). MainActivity may differ ONLY by the one registration line in onCreate.
//   d) every library on the base's releaseRuntimeClasspath keeps the SAME version (old → new listed); a
//      dependency line that cannot be read → CANNOT MEASURE
//   e) the WHOLE merged manifest: only new CameraX / ML Kit elements, each one traced by the merge report
//      (no merge report, or a new element without a line in it → CANNOT MEASURE — a name alone allows
//      nothing); anything else added / removed / changed (intent-filters, uses-library, permission
//      declarations, application settings …) = FAIL; <application> and BLUETOOTH_CONNECT must be there; an
//      empty manifest = FAIL
//   g) EVERY other file in the .aab (assets incl. capacitor.config.json / capacitor.plugins.json, res,
//      resources.pb, root/META-INF, BundleConfig.pb, any file under base/lib/ that is not a
//      <chip>/<name>.so …): unchanged, except the 3 sfl_qr drawables and new CameraX / ML Kit files (new
//      resources, the ML Kit model folder, new libraries' version files). resources.pb and compiled res XML
//      are compared by NAME with resource numbers taken out (those numbers move whenever any resource is
//      added), following aapt2's Resources.proto. NOT compared, and only these: the baseline profile
//      (baseline.prof / baseline.profm) and version-control-info.textproto — they differ in every build;
//      the .aab's signature files; the library list (that is check d).
//   f) per-phone download growth ≤ max MB (a size table with no rows or a value that is not a number →
//      CANNOT MEASURE); every NEW .so has 16 KB-aligned load segments
// Any FAIL → "STOP — do not release" + the reasons. Exit 0 = PASS, 1 = FAIL, 2 = CANNOT MEASURE — STOP.
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
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
  return { ok: same, lines: [`${same ? "PASS" : "FAIL"} a) chip types: base [${mainAbis.join(", ")}] · new [${newAbis.join(", ")}]`] };
}

export function checkSoHashes(mainLibs, newLibs) {
  const lines = [], bad = [];
  for (const [k, m] of [...mainLibs].sort()) {
    const n = newLibs.get(k);
    if (!n) { bad.push(`${k} missing`); lines.push(`  MISSING ${k} (base ${m.hash})`); continue; }
    const same = n.hash === m.hash;
    if (!same) bad.push(`${k} changed`);
    lines.push(`  ${same ? "same   " : "CHANGED"} ${k} ${m.hash}${same ? "" : ` → ${n.hash}`}`);
  }
  const added = [...newLibs.keys()].filter((k) => !mainLibs.has(k)).sort();
  for (const k of added) lines.push(`  new     ${k} ${newLibs.get(k).hash}`);
  return { ok: bad.length === 0, bad, added, lines: [`${bad.length ? "FAIL" : "PASS"} b) native libraries of the base: ${mainLibs.size - bad.length}/${mainLibs.size} identical (sha256)${bad.length ? ` — ${bad.join(", ")}` : ""}`, ...lines] };
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
  if (im < 0) return m; // no MAX column = nothing readable
  for (const r of rows) {
    if (r.every((c) => !String(c).trim())) continue;
    const raw = String(r[im] ?? "").trim();
    m.set(ia >= 0 ? String(r[ia] ?? "").trim() : "all", /^\d+$/.test(raw) ? Number(raw) : NaN);
  }
  return m;
}
export function checkSize({ mainCsv, newCsv, mainAab, newAab, maxMb }) {
  const cannot = (why) => ({ ok: false, cannot: true, lines: [`CANNOT MEASURE f) size: ${why}`] });
  const real = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!real(maxMb)) return cannot("the size limit is not a number");
  if (mainCsv || newCsv) {
    if (!mainCsv || !newCsv) return cannot(`no size table for the ${!mainCsv ? "base" : "new"} build`);
    const b = parseSizeCsv(mainCsv), a = parseSizeCsv(newCsv);
    if (!b.size || !a.size) return cannot(`the size table of the ${!b.size ? "base" : "new"} build has no rows`);
    for (const [side, m] of [["base", b], ["new", a]]) for (const [abi, v] of m) if (!real(v)) return cannot(`the size of ${abi || "?"} in the ${side} table is not a number`);
    for (const abi of a.keys()) if (!b.has(abi)) return cannot(`no row for ${abi} in the base size table`);
    let worst = 0; const parts = [];
    for (const [abi, v] of [...a].sort()) {
      const grow = (v - b.get(abi)) / 1e6;
      worst = Math.max(worst, grow);
      parts.push(`${abi}: ${(b.get(abi) / 1e6).toFixed(1)} → ${(v / 1e6).toFixed(1)} MB (+${grow.toFixed(1)})`);
    }
    const ok = worst <= maxMb;
    return { ok, lines: [`${ok ? "PASS" : "FAIL"} f) size: per-phone download +${worst.toFixed(1)} MB at most (limit ${maxMb} MB) — ${parts.join("; ")}`] };
  }
  if (!real(mainAab) || !real(newAab) || !mainAab || !newAab) return cannot("the .aab sizes are not numbers");
  const grow = (newAab - mainAab) / 1e6;
  const ok = grow <= maxMb;
  return { ok, lines: [`${ok ? "PASS" : "FAIL"} f) size: .aab ${(mainAab / 1e6).toFixed(1)} → ${(newAab / 1e6).toFixed(1)} MB (+${grow.toFixed(1)}, limit ${maxMb} MB; install bundletool for the per-phone sizes)`] };
}

// ── c) printer code in the dex ──────────────────────────────────────────────────────────────
/**
 * dexdump -d -a output → Map<descriptor, {text, refs:Set}>. Normalized so that a class whose code did not
 * change reads the same in both builds: file offsets, dex index numbers (string@ / method@ / type@ / field@,
 * "Annotations on method #123") and source line numbers / local variable tables are removed — those move
 * when OTHER classes are added. A class's annotations ("Class #N annotations:" comes BEFORE "Class #N -")
 * are part of that class's text.
 */
export function parseDexdump(text) {
  const classes = new Map();
  let cur = null, lines = [], skipDebug = false, anno = null, annoFor = null;
  const flush = () => {
    if (!cur) return;
    const t = lines.join("\n");
    const refs = new Set(t.match(/L[A-Za-z0-9_$/\-]+;/g) || []);
    refs.delete(cur);
    const prev = classes.get(cur);
    classes.set(cur, prev ? { text: prev.text + "\n" + t, refs: new Set([...prev.refs, ...refs]) } : { text: t, refs });
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const an = /^Class #(\d+) annotations:\s*$/.exec(raw);
    if (an) { flush(); cur = null; lines = []; anno = []; annoFor = an[1]; continue; }
    const head = /^Class #(\d+)\s+-/.exec(raw);
    if (head) {
      flush(); cur = null; skipDebug = false;
      lines = anno && annoFor === head[1] ? anno.map((l) => `anno ${l}`) : [];
      anno = null; annoFor = null;
      continue;
    }
    if (/^Class #\d+ header:/.test(raw) || /^(Processing|Opened|DEX file header)/.test(raw)) { flush(); cur = null; lines = []; anno = null; continue; }
    if (anno) {
      if (/^\s*$/.test(raw)) continue;
      anno.push(raw.replace(/^(Annotations on (?:method|field)) #\d+ /, "$1 ").trimEnd());
      continue;
    }
    const d = /^\s*Class descriptor\s*:\s*'([^']+)'/.exec(raw);
    if (d) { cur = d[1]; lines.unshift(`class ${cur}`); continue; }
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

// ── D8 synthetic helpers ($$ExternalSynthetic…) ───────────────────────────────────────────────
// D8 puts small Java-backport helpers (e.g. AtomicReference.compareAndSet for old Android) into shared
// "$$ExternalSynthetic…" classes, merges IDENTICAL helpers into one, and names that class after the
// alphabetically first class that uses it. Adding the camera code therefore renames helpers (androidx/lifecycle/…
// → androidx/camera/…) and adds methods to a shared helper class, without changing any code. So: a call to a
// helper is compared by the helper's BODY (not its class name), and a helper class counts as the same when every
// one of its base methods exists with the identical body in the new build.
export const SYNTH_CLASS = /\$\$ExternalSynthetic[A-Za-z]*\d*;$/;
const SYNTH_CALL = /L[A-Za-z0-9_$/\-]*\$\$ExternalSynthetic[A-Za-z]*\d*;\.([A-Za-z0-9_$<>]+):(\([^)]*\)\S+)/g;
/** The methods of one class's normalized text: [{ key: "name:type", body }] (the "#k" position is not part of it). */
export function methodsOf(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split("\n")) {
    if (/^\s*#\d+\s*:\s*\(in L/.test(line)) { if (cur) out.push(cur); cur = { name: "", type: "", lines: [] }; continue; }
    if (!cur) continue;
    if (/^\s*(Virtual methods|Direct methods|Instance fields|Static fields)\b/.test(line) || /^source_file /.test(line)) { out.push(cur); cur = null; continue; }
    const nm = /^\s*name\s*:\s*'([^']*)'/.exec(line); if (nm && !cur.name) cur.name = nm[1];
    const ty = /^\s*type\s*:\s*'([^']*)'/.exec(line); if (ty && !cur.type) cur.type = ty[1];
    // the code header "owner.name:type" carries the helper's CLASS name → not part of the body
    if (/^\s*[A-Za-z0-9_$.]+\.[A-Za-z0-9_$<>]+:\(.*\)\S+\s*$/.test(line)) continue;
    cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out.map((m) => ({ key: `${m.name}:${m.type}`, body: m.lines.join("\n").replace(/\(in L[^)]*\)/g, "") }));
}
/** Every synthetic helper method of one build: "Lowner;.name:type" → body, and body → true. */
export function synthIndex(classes) {
  const byRef = new Map(), bodies = new Set();
  for (const [d, c] of classes) {
    if (!SYNTH_CLASS.test(d)) continue;
    for (const m of methodsOf(c.text)) {
      byRef.set(`${d}.${m.key.replace(":", ":")}`, m.body);
      bodies.add(`${m.key}\n${m.body}`);
    }
  }
  return { byRef, bodies };
}
/** A class's text with each call to a synthetic helper replaced by the helper's body (hashed). */
export function canonSynthCalls(text, idx) {
  return String(text).replace(SYNTH_CALL, (all, name, type) => {
    const owner = all.slice(0, all.indexOf(";.") + 1);
    const body = idx.byRef.get(`${owner}.${name}:${type}`);
    return body === undefined ? all : `SYNTH[${sha(Buffer.from(`${name}:${type}\n${body}`)).slice(0, 16)}].${name}:${type}`;
  });
}
/** The first lines where two normalized texts differ (for the report). */
export function firstDiff(a, b, max = 6) {
  const x = String(a).split("\n"), y = String(b).split("\n"), out = [];
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n && out.length < max * 2; i++) {
    if (x[i] === y[i]) continue;
    if (x[i] !== undefined) out.push(`      - ${x[i].trim()}`);
    if (y[i] !== undefined) out.push(`      + ${y[i].trim()}`);
  }
  return out;
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
  let same = 0, viaSynth = 0;
  const changed = [], details = [];
  const mIdx = synthIndex(mainClasses), nIdx = synthIndex(newClasses);
  for (const d of [...closure].sort()) {
    const m = mainClasses.get(d), n = newClasses.get(d);
    if (SYNTH_CLASS.test(d)) {
      // a shared D8 helper class: every base method must exist with the identical body in the new build
      const lost = methodsOf(m.text).filter((x) => !nIdx.bodies.has(`${x.key}\n${x.body}`));
      if (!lost.length) { same++; if (!n || n.text !== m.text) viaSynth++; continue; }
      changed.push(`${d} ${n ? "changed" : "missing"} (${lost.length} helper method(s) not found unchanged: ${lost.slice(0, 3).map((x) => x.key).join(", ")})`);
      continue;
    }
    if (!n) { changed.push(`${d} missing`); continue; }
    if (m.text === n.text) { same++; continue; }
    if (d === MAIN_ACTIVITY && mainActivityOnlyRegistration(m.text, n.text)) { lines.push(`  MainActivity: identical except the one added line registerPlugin(SellerFlowScannerPlugin.class) in onCreate`); same++; continue; }
    const cm = canonSynthCalls(m.text, mIdx), cn = canonSynthCalls(n.text, nIdx);
    if (cm === cn) { same++; viaSynth++; continue; }
    changed.push(`${d} changed`);
    if (details.length < 60) details.push(`  what changed in ${d}:`, ...firstDiff(cm, cn));
  }
  bad.push(...changed);
  const appCount = [...closure].filter((d) => d.startsWith("Lcom/sellerflow/live/")).length;
  lines.unshift(`  ${closure.size} classes reached by the printer code (${libInDex.length} from the printer libraries, ${appCount} of our own, the rest from Capacitor / androidx / Java libraries they use) — ${same} identical`);
  if (viaSynth) lines.push(`  ${viaSynth} of them read the same once D8's shared helper classes are compared by body (helpers renamed or grouped by the build tool, code unchanged)`);
  for (const c of changed.slice(0, 40)) lines.push(`  CHANGED ${c}`);
  if (changed.length > 40) lines.push(`  … and ${changed.length - 40} more`);
  lines.push(...details);
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
/**
 * `gradlew :app:dependencies --configuration releaseRuntimeClasspath` → { deps: Map<group:artifact, version>,
 * unreadable: [lines] }. A dependency line the parser cannot read with certainty — a {require …} / {prefer …}
 * / {reject …} version, FAILED, "(n)" (not resolved), or any other shape — goes to `unreadable` (the gate
 * then stops: CANNOT MEASURE). "(c)" = a version constraint, not a dependency; "(*)" = shown before.
 */
export function parseGradleDeps(text) {
  const deps = new Map(), unreadable = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!/^[| ]*[+\\]--- /.test(raw)) continue;
    const bad = () => unreadable.push(raw.trim());
    let s = raw.replace(/^[| ]*[+\\]--- /, "").trim();
    if (/FAILED/.test(s)) { bad(); continue; }
    if (s.startsWith("project ")) { if (!/^project :[\w.:-]+( \(\*\))?$/.test(s)) bad(); continue; }
    s = s.replace(/\{strictly ([^{}\s;]+)\}/g, "$1");
    if (/[{}]/.test(s)) { bad(); continue; }
    const flag = /\s\((\*|c|n)\)$/.exec(s);
    if (flag && flag[1] === "n") { bad(); continue; }
    if (flag && flag[1] === "c") continue;
    s = s.replace(/\s\(\*\)$/, "");
    const r = /^([\w.-]+):([\w.-]+)(?::([\w.+-]+))?(?: -> ([\w.+-]+))?$/.exec(s);
    if (!r || !(r[4] || r[3])) { bad(); continue; }
    deps.set(`${r[1]}:${r[2]}`, r[4] || r[3]);
  }
  return { deps, unreadable };
}
export function checkDeps(main, next) {
  const mainDeps = main.deps, newDeps = next.deps;
  const unreadable = [...main.unreadable.map((l) => `base: ${l}`), ...next.unreadable.map((l) => `new: ${l}`)];
  if (unreadable.length || !mainDeps.size || !newDeps.size) {
    const why = unreadable.length ? `${unreadable.length} dependency line(s) it cannot read` : "the dependency list is empty";
    return { ok: false, cannot: true, added: [], lines: [`CANNOT MEASURE d) libraries: ${why}`, ...unreadable.slice(0, 20).map((x) => `  UNREADABLE ${x}`)] };
  }
  const bumped = [], gone = [];
  for (const [k, v] of [...mainDeps].sort()) {
    const n = newDeps.get(k);
    if (!n) gone.push(`${k} ${v} → (gone)`);
    else if (n !== v) bumped.push(`${k} ${v} → ${n}`);
  }
  const added = [...newDeps].filter(([k]) => !mainDeps.has(k)).map(([k, v]) => `${k}:${v}`).sort();
  const ok = !bumped.length && !gone.length;
  return { ok, added: added.map((x) => x.split(":").slice(0, 2).join(":")), lines: [
    `${ok ? "PASS" : "FAIL"} d) libraries: ${mainDeps.size} on the base — ${bumped.length} version change(s), ${gone.length} removed`,
    ...bumped.map((x) => `  CHANGED ${x}`), ...gone.map((x) => `  REMOVED ${x}`),
    `  ${added.length} new (CameraX / ML Kit and what they bring): ${added.join(", ") || "none"}`,
  ] };
}

// ── e) the whole merged manifest ────────────────────────────────────────────────────────────
/** Small XML reader for the merged AndroidManifest.xml: elements + attributes (comments, <?…?>, text skipped). */
export function parseXml(text) {
  const s = String(text);
  const top = { tag: "#document", attrs: [], children: [] };
  const stack = [top];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); if (e < 0) throw new Error("unclosed comment"); i = e + 3; continue; }
    if (s.startsWith("<?", lt)) { const e = s.indexOf("?>", lt + 2); if (e < 0) throw new Error("unclosed <?"); i = e + 2; continue; }
    if (s.startsWith("<!", lt)) throw new Error("unexpected <! in the manifest");
    if (s[lt + 1] === "/") {
      const e = s.indexOf(">", lt);
      if (e < 0) throw new Error("unclosed end tag");
      const tag = s.slice(lt + 2, e).trim();
      const el = stack.pop();
      if (!el || el === top || el.tag !== tag) throw new Error(`unexpected </${tag}>`);
      i = e + 1;
      continue;
    }
    let j = lt + 1, q = null;
    for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    if (j >= s.length) throw new Error("unclosed tag");
    let body = s.slice(lt + 1, j);
    const self = /\/\s*$/.test(body);
    if (self) body = body.replace(/\/\s*$/, "");
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new Error("tag without a name");
    const rest = body.slice(m[1].length);
    const attrs = [...rest.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3]]);
    if (rest.replace(/([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, "").trim()) throw new Error(`unreadable attributes in <${m[1]}>`);
    const el = { tag: m[1], attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
    i = j + 1;
  }
  if (stack.length !== 1) throw new Error("unclosed element");
  return top;
}
const attrOf = (el, name) => (el.attrs.find(([k]) => k === name) || [])[1];
/** One element and everything inside it, as one string (attributes sorted, children sorted). */
export function canonXml(el) {
  const at = [...el.attrs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => ` ${k}="${v}"`).join("");
  return `<${el.tag}${at}>${el.children.map(canonXml).sort().join("")}</${el.tag}>`;
}
const label = (el) => `${el.tag}${attrOf(el, "android:name") ? " " + attrOf(el, "android:name") : ""}`;
/** Children present on one side only (as a multiset of whole elements). */
function diffChildren(a, b) {
  const count = new Map();
  for (const c of a) { const k = canonXml(c); count.set(k, (count.get(k) || 0) + 1); }
  const added = [];
  for (const c of b) { const k = canonXml(c); const n = count.get(k) || 0; if (n) count.set(k, n - 1); else added.push(c); }
  const removed = [];
  const left = new Map(count);
  for (const c of a) { const k = canonXml(c); const n = left.get(k) || 0; if (n) { left.set(k, n - 1); removed.push(c); } }
  return { added, removed };
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
const SCANNER_ORIGINS = /^(androidx\.camera|com\.google\.mlkit|com\.google\.android\.gms|com\.google\.android\.datatransport|com\.google\.firebase)(\.[\w.-]+)?:/;
const PRINTER_WORDS = /bluetooth|location|nearby|printer|niimbot|(^|\.)ble/i;
const NEW_OK_IN_APP = new Set(["activity", "activity-alias", "service", "receiver", "provider", "meta-data"]);
const VERSION_ATTRS = new Set(["android:versionCode", "android:versionName"]);
export function checkManifest(mainXml, newXml, blameText) {
  const fails = [], allowed = [], lines = [];
  const read = (xml, side) => {
    if (!String(xml || "").trim()) { fails.push(`the ${side} manifest is empty`); return null; }
    try {
      const doc = parseXml(xml);
      const m = doc.children.find((c) => c.tag === "manifest");
      if (!m) fails.push(`the ${side} manifest has no <manifest>`);
      return m || null;
    } catch (e) { fails.push(`the ${side} manifest cannot be read (${e.message})`); return null; }
  };
  const a = read(mainXml, "base"), b = read(newXml, "new");
  const unsure = []; // what cannot be judged without the merge report
  const done = () => {
    if (unsure.length) return { ok: false, cannot: true, lines: [`CANNOT MEASURE e) manifest: ${unsure[0]}${unsure.length > 1 ? ` (+${unsure.length - 1} more)` : ""}`, ...unsure.slice(1).map((u) => `  UNSURE ${u}`), ...lines, ...fails.map((f) => `  FAIL ${f}`)] };
    return { ok: !fails.length, lines: [`${fails.length ? "FAIL" : "PASS"} e) manifest: ${fails.length ? fails.length + " problem(s)" : `everything the same except ${allowed.length} new CameraX / ML Kit part(s)`}`, ...lines, ...fails.map((f) => `  FAIL ${f}`)] };
  };
  if (!a || !b) return done();
  // The merge report says which library added each element. Without it nothing new can be allowed
  // (a name that looks like CameraX / ML Kit is not proof).
  const blame = String(blameText || "").trim() ? parseBlame(blameText) : new Map();
  if (!blame.size) unsure.push("no merge report (manifest-merger-blame-release-report.txt) for the new build — a new part cannot be traced to CameraX / ML Kit");
  for (const [m, side] of [[a, "base"], [b, "new"]]) {
    if (!m.children.some((c) => c.tag === "application")) fails.push(`no <application> in the ${side} manifest`);
    if (!m.children.some((c) => c.tag === "uses-permission" && attrOf(c, "android:name") === "android.permission.BLUETOOTH_CONNECT")) fails.push(`no BLUETOOTH_CONNECT permission in the ${side} manifest (printer / Bluetooth)`);
  }
  // <manifest> attributes: only the version may differ
  const ra = new Map(a.attrs), rb = new Map(b.attrs);
  for (const k of new Set([...ra.keys(), ...rb.keys()])) {
    if (ra.get(k) === rb.get(k)) continue;
    if (VERSION_ATTRS.has(k)) lines.push(`  version: ${k} ${ra.get(k) ?? "-"} → ${rb.get(k) ?? "-"}`);
    else fails.push(`<manifest> ${k} changed: ${ra.get(k) ?? "(none)"} → ${rb.get(k) ?? "(none)"}`);
  }
  const origin = (key) => blame.get(key) || "";
  const fromScanner = (key) => {
    const from = origin(key);
    if (from && from !== "unknown") return { ok: SCANNER_ORIGINS.test(from + ":"), from }; // from = "group:artifact"
    return { ok: false, from: "", unknown: true }; // no merge report line: never allowed by its name alone
  };
  const judgeNew = (el, where) => {
    const name = attrOf(el, "android:name");
    const okTag = where === "queries" ? el.tag === "package" : NEW_OK_IN_APP.has(el.tag);
    if (!okTag || !name) { fails.push(`NEW ${label(el)} in <${where}> — only CameraX / ML Kit components, meta-data or packages may be added`); return; }
    const key = el.tag === "meta-data" || el.tag === "package" ? name : `${el.tag} ${name}`;
    const f = fromScanner(key);
    if (f.unknown) { if (blame.size) unsure.push(`NEW ${label(el)} has no line in the merge report — it cannot be traced to CameraX / ML Kit`); return; }
    if (f.ok && !PRINTER_WORDS.test(name)) allowed.push(`${label(el)} (from ${f.from})`);
    else fails.push(`NEW ${label(el)} (from ${f.from || "?"}) — not a CameraX / ML Kit part`);
  };
  // top level (uses-permission, uses-feature, uses-sdk, permission declarations …): nothing added, removed or changed
  const plain = (m) => m.children.filter((c) => c.tag !== "application" && c.tag !== "queries");
  const top = diffChildren(plain(a), plain(b));
  for (const el of top.removed) fails.push(`removed or changed: <${label(el)}>${PRINTER_WORDS.test(label(el)) ? " (printer / Bluetooth)" : ""}`);
  for (const el of top.added) fails.push(`NEW <${label(el)}>${el.tag === "uses-permission" ? " (a new permission)" : ""}`);
  // <queries>: nothing removed or changed; new packages only from CameraX / ML Kit
  const q = (m) => m.children.filter((c) => c.tag === "queries");
  const qa = q(a), qb = q(b);
  const qAttrs = (l) => l.map((c) => canonXml({ ...c, children: [] })).sort().join("");
  if (qa.length && qb.length && qAttrs(qa) !== qAttrs(qb)) fails.push("<queries> settings changed");
  const qd = diffChildren(qa.flatMap((c) => c.children), qb.flatMap((c) => c.children));
  // An element of the base whose content changed shows up as removed + added: that is a change (FAIL above),
  // not a new part to trace.
  const idOf = (el) => `${el.tag} ${attrOf(el, "android:name") || ""}`;
  const changedIn = (d) => new Set(d.removed.map(idOf));
  for (const el of qd.removed) fails.push(`removed or changed in <queries>: <${label(el)}>`);
  { const ch = changedIn(qd); for (const el of qd.added) if (!ch.has(idOf(el))) judgeNew(el, "queries"); }
  // <application>: same settings; nothing removed or changed (intent-filters, uses-library … included); new only CameraX / ML Kit
  const appA = a.children.find((c) => c.tag === "application"), appB = b.children.find((c) => c.tag === "application");
  if (appA && appB) {
    const aa = new Map(appA.attrs), ab = new Map(appB.attrs);
    for (const k of new Set([...aa.keys(), ...ab.keys()])) if (aa.get(k) !== ab.get(k)) fails.push(`application setting ${k} changed: ${aa.get(k) ?? "(none)"} → ${ab.get(k) ?? "(none)"}`);
    const ad = diffChildren(appA.children, appB.children);
    for (const el of ad.removed) fails.push(`removed or changed in <application>: <${label(el)}>${PRINTER_WORDS.test(label(el)) ? " (printer / Bluetooth)" : ""}`);
    { const ch = changedIn(ad); for (const el of ad.added) if (!ch.has(idOf(el))) judgeNew(el, "application"); }
  }
  const bt = b.children.filter((c) => c.tag === "uses-permission" && PRINTER_WORDS.test(attrOf(c, "android:name") || "")).map((c) => attrOf(c, "android:name")).sort();
  lines.push(`  Bluetooth / location permissions (same as the base): ${bt.join(", ") || "none"}`);
  lines.push(`  new CameraX / ML Kit parts (allowed): ${allowed.length ? "" : "none"}`, ...allowed.map((x) => `    ${x}`));
  return done();
}

// ── g) every other file in the .aab ─────────────────────────────────────────────────────────
// Protobuf (aapt2 Resources.proto, AOSP frameworks/base/tools/aapt2/Resources.proto) read without a library.
function pbVarint(buf, pos) {
  let res = 0n, shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("cut-off number");
    const b = buf[pos++];
    res |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [res, pos];
    shift += 7n;
    if (shift > 63n) throw new Error("number too long");
  }
}
/** A protobuf message → its fields in order: { no, wt, val: bigint | Buffer }. Throws on anything odd. */
export function pbFields(buf) {
  const out = [];
  let p = 0;
  while (p < buf.length) {
    let key;
    [key, p] = pbVarint(buf, p);
    const no = Number(key >> 3n), wt = Number(key & 7n);
    if (no < 1) throw new Error("field number 0");
    if (wt === 0) { let v; [v, p] = pbVarint(buf, p); out.push({ no, wt, val: v }); }
    else if (wt === 1 || wt === 5) { const n = wt === 1 ? 8 : 4; if (p + n > buf.length) throw new Error("cut-off value"); out.push({ no, wt, val: buf.subarray(p, p + n) }); p += n; }
    else if (wt === 2) { let len; [len, p] = pbVarint(buf, p); const n = Number(len); if (p + n > buf.length) throw new Error("cut-off bytes"); out.push({ no, wt, val: buf.subarray(p, p + n) }); p += n; }
    else throw new Error(`wire type ${wt}`);
  }
  return out;
}
// Per message: field → "drop" (not compared: source lines/paths, comments, resource numbers),
// "id" (Reference.id: dropped only when the reference carries a name), a message name, or raw.
// `sorted` = repeated fields whose order follows resource numbers (compared as a set).
const PB = {
  Entry: { f: { 1: "drop", 3: "Visibility", 4: "AllowNew", 5: "OverlayableItem", 6: "ConfigValue", 7: "drop", 8: "ConfigValue" } },
  Visibility: { f: { 2: "drop", 3: "drop" } },
  AllowNew: { f: { 1: "drop", 2: "drop" } },
  OverlayableItem: { f: { 1: "drop", 2: "drop" } },
  ConfigValue: { f: { 2: "Value" } },
  Value: { f: { 1: "drop", 2: "drop", 4: "Item", 5: "CompoundValue" } },
  Item: { f: { 1: "Reference" } },
  CompoundValue: { f: { 1: "Attribute", 2: "Style", 3: "Styleable", 4: "Array", 5: "Plural", 6: "MacroBody" } },
  Reference: { f: { 2: "id" } },
  Attribute: { f: { 4: "Symbol" }, sorted: [4] },
  Symbol: { f: { 1: "drop", 2: "drop", 3: "Reference" } },
  Style: { f: { 1: "Reference", 2: "drop", 3: "StyleEntry" }, sorted: [3] },
  StyleEntry: { f: { 1: "drop", 2: "drop", 3: "Reference", 4: "Item" } },
  Styleable: { f: { 1: "StyleableEntry" }, sorted: [1] },
  StyleableEntry: { f: { 1: "drop", 2: "drop", 3: "Reference" } },
  Array: { f: { 1: "ArrayElement" } },
  ArrayElement: { f: { 1: "drop", 2: "drop", 3: "Item" } },
  Plural: { f: { 1: "PluralEntry" }, sorted: [1] },
  PluralEntry: { f: { 1: "drop", 2: "drop", 4: "Item" } },
  MacroBody: { f: { 5: "drop" } },
  XmlNode: { f: { 1: "XmlElement" } },
  XmlElement: { f: { 4: "XmlAttribute", 5: "XmlNode" }, sorted: [4] },
  XmlAttribute: { f: { 5: "attrId", 6: "Item" } },
};
const hexOf = (f) => (f.wt === 0 ? `v${f.val}` : `${f.wt === 2 ? "b" : "f"}${f.val.toString("hex")}`);
/** A message as one comparable string, without the fields that only carry source places or numbers. */
export function pbCanon(type, buf) {
  const sch = PB[type] || { f: {} };
  const fields = pbFields(buf);
  const named = fields.some((f) => f.no === (type === "Reference" ? 3 : type === "XmlAttribute" ? 2 : -1) && f.wt === 2 && f.val.length > 0);
  const parts = new Map();
  for (const f of fields) {
    const spec = sch.f[f.no];
    if (spec === "drop") continue;
    if ((spec === "id" || spec === "attrId") && named && f.wt === 0) continue;
    let c;
    if (spec && spec !== "id" && spec !== "attrId") {
      if (f.wt !== 2) throw new Error(`${type}.${f.no}: expected a message`);
      c = `{${pbCanon(spec, f.val)}}`;
    } else c = hexOf(f);
    if (!parts.has(f.no)) parts.set(f.no, []);
    parts.get(f.no).push(c);
  }
  return [...parts.keys()].sort((x, y) => x - y).map((no) => {
    const l = (sch.sorted || []).includes(no) ? [...parts.get(no)].sort() : parts.get(no);
    return `${no}=${l.join(",")}`;
  }).join(";");
}
const utf8 = (b) => Buffer.from(b).toString("utf8");
/** resources.pb → Map<"package:type/name", comparable value> (+ "#table:N" for table-level parts). */
export function resourceEntries(buf) {
  const out = new Map();
  for (const t of pbFields(buf)) {
    if (t.no === 1 || t.no === 4) continue; // source path pool, tool versions
    if (t.no !== 2) { out.set(`#table:${t.no}`, (out.get(`#table:${t.no}`) || "") + hexOf(t)); continue; }
    const pkgFields = pbFields(t.val);
    const pkg = utf8(pkgFields.find((f) => f.no === 2)?.val || "");
    for (const pf of pkgFields) {
      if (pf.no !== 3) continue;
      const tf = pbFields(pf.val);
      const type = utf8(tf.find((f) => f.no === 2)?.val || "");
      for (const ef of tf) {
        if (ef.no !== 3) continue;
        const ent = pbFields(ef.val);
        const name = utf8(ent.find((f) => f.no === 2)?.val || "");
        if (!type || !name) throw new Error("a resource without a type or name");
        out.set(`${pkg}:${type}/${name}`, pbCanon("Entry", ef.val));
      }
    }
  }
  return out;
}
const RES_KEY = (n) => { // base/res/drawable-v24/sfl_qr_close.xml → drawable/sfl_qr_close
  const m = /^base\/res\/([^/-]+)[^/]*\/([^/]+?)(\.9)?(\.[^./]+)?$/.exec(n);
  return m ? `${m[1]}/${m[2]}` : null;
};
export const QR_DRAWABLES = ["sfl_qr_close", "sfl_qr_light_off", "sfl_qr_light_on"];
const MLKIT_ASSETS = "base/assets/mlkit_barcode_models/";
const SIGNATURE = /^META-INF\/[^/]+\.(MF|SF|RSA|DSA|EC)$/i;
/**
 * The ONLY files that may differ without being compared (exact paths, no pattern): the baseline profile is
 * rebuilt from the dex of each build, and version-control-info holds the commit the build was made from
 * (in an .aab the app's root files sit under base/root/).
 */
export const EXPECTED_DIFF = new Set([
  "BUNDLE-METADATA/com.android.tools.build.profiles/baseline.prof",
  "BUNDLE-METADATA/com.android.tools.build.profiles/baseline.profm",
  "META-INF/version-control-info.textproto",
  "base/root/META-INF/version-control-info.textproto",
]);
/**
 * base/assets.pb = the bundle's list of asset folders (bundletool Assets: repeated { 1: path, 2: targeting }).
 * Adding the ML Kit model folder changes its bytes, so it is compared by entry: every base folder must be
 * there unchanged, and the only new folders allowed are the ML Kit model folder(s).
 */
export function assetDirEntries(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const varint = (st) => { let r = 0, m = 1, b; do { if (st.i >= st.end) throw new Error("truncated varint"); b = u[st.i++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
  const out = [];
  const top = { i: 0, end: u.length };
  while (top.i < top.end) {
    const tag = varint(top), f = Math.floor(tag / 8), wt = tag & 7;
    if (wt !== 2) throw new Error(`unexpected wire type ${wt}`);
    const len = varint(top), start = top.i, stop = start + len;
    if (stop > u.length) throw new Error("truncated entry");
    top.i = stop;
    if (f !== 1) { out.push({ path: `#field${f}`, rest: Buffer.from(u.slice(start, stop)).toString("hex") }); continue; }
    const st = { i: start, end: stop };
    let path = null; const rest = [];
    while (st.i < st.end) {
      const t2 = varint(st), f2 = Math.floor(t2 / 8), w2 = t2 & 7;
      if (w2 === 2) { const l2 = varint(st); const b2 = u.slice(st.i, st.i + l2); st.i += l2; if (f2 === 1) path = Buffer.from(b2).toString("utf8"); else rest.push(`${f2}:${Buffer.from(b2).toString("hex")}`); }
      else if (w2 === 0) rest.push(`${f2}=${varint(st)}`);
      else throw new Error(`unexpected wire type ${w2}`);
    }
    if (path === null) throw new Error("asset folder without a path");
    out.push({ path, rest: rest.join(",") });
  }
  return out;
}
export function compareAssetDirs(mainBuf, newBuf) {
  const a = assetDirEntries(mainBuf), b = assetDirEntries(newBuf);
  const key = (e) => `${e.path}|${e.rest}`;
  const kb = new Set(b.map(key)), ka = new Set(a.map(key));
  const missing = a.filter((e) => !kb.has(key(e))).map((e) => e.path);
  const added = b.filter((e) => !ka.has(key(e))).map((e) => e.path);
  const badNew = added.filter((p) => !/^assets\/mlkit_barcode_models(\/|$)/.test(p));
  return { baseCount: a.length, missing, added, badNew };
}
/** Every entry of the two .aab files except dex (c), lib (b) and the manifest (e). */
export function checkBundleEntries(mainZip, newZip, ctx = {}) {
  const addedDeps = ctx.addedDeps || [], newSo = (ctx.newSo || []).map((k) => k.split("/").pop());
  const fails = [], notes = [], allowedNew = [];
  let cannot = null, compared = 0;
  // Checked by another part: the dex (c), the native libraries themselves (a, b — ONLY base/lib/<chip>/<name>.so;
  // any other file under base/lib/, e.g. wrap.sh, is compared here like every other file), the manifest (e), the
  // library list (d). The .aab's own signature files list a digest of every entry, so they differ by definition.
  const skip = (n) => /^base\/dex\//.test(n) || LIB_RE.test(n) || n === "base/manifest/AndroidManifest.xml" || SIGNATURE.test(n) || n === "BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb";
  const notCompared = [];
  // the resource table first: which resources are new, which existing ones changed
  let addedRes = new Set();
  const rm = mainZip.get("base/resources.pb"), rn = newZip.get("base/resources.pb");
  if (!rm || !rn) fails.push(`resources.pb missing in the ${!rm ? "base" : "new"} build`);
  else {
    try {
      const a = resourceEntries(rm()), b = resourceEntries(rn());
      let changed = 0;
      for (const [k, v] of a) {
        if (!b.has(k)) fails.push(`resource removed: ${k}`);
        else if (b.get(k) !== v) { changed++; fails.push(`resource changed: ${k}`); }
      }
      const added = [...b.keys()].filter((k) => !a.has(k)).sort();
      addedRes = new Set(added.map((k) => k.slice(k.indexOf(":") + 1)));
      const qr = added.filter((k) => QR_DRAWABLES.some((q) => k.endsWith(`:drawable/${q}`)));
      notes.push(`  resources.pb: ${a.size} resources of the base — ${a.size - changed - fails.filter((f) => f.startsWith("resource removed")).length} the same by name and value; ${added.length} new (${qr.length} sfl_qr drawables + ${added.length - qr.length} from the new libraries)`);
      if (added.length - qr.length) notes.push(`    new: ${added.filter((k) => !qr.includes(k)).slice(0, 25).join(", ")}${added.length - qr.length > 25 ? ` … +${added.length - qr.length - 25}` : ""}`);
      compared++;
    } catch (e) { cannot = `resources.pb cannot be read (${e.message})`; }
  }
  const names = [...new Set([...mainZip.keys(), ...newZip.keys()])].sort();
  for (const n of names) {
    if (skip(n) || n === "base/resources.pb") continue;
    if (n === "base/assets.pb") {
      const ga = mainZip.get(n), gb = newZip.get(n);
      if (!ga || !gb) { fails.push(`assets.pb missing in the ${!ga ? "base" : "new"} build`); continue; }
      try {
        const r = compareAssetDirs(ga(), gb());
        compared++;
        for (const m of r.missing) fails.push(`asset folder removed or changed: ${m}`);
        for (const x of r.badNew) fails.push(`NEW asset folder not from ML Kit: ${x}`);
        notes.push(`  assets.pb: ${r.baseCount} asset folder(s) of the base — ${r.baseCount - r.missing.length} the same; new: ${r.added.join(", ") || "none"}`);
      } catch (e) { cannot = cannot || `assets.pb cannot be read (${e.message})`; }
      continue;
    }
    if (EXPECTED_DIFF.has(n)) { notCompared.push(n); continue; }
    const ga = mainZip.get(n), gb = newZip.get(n);
    if (ga && !gb) { fails.push(`removed: ${n}`); continue; }
    if (!ga) {
      const key = RES_KEY(n);
      let why = null;
      if (n.startsWith("base/res/") && key && addedRes.has(key)) why = QR_DRAWABLES.some((q) => key === `drawable/${q}`) ? "sfl_qr drawable" : "new resource";
      else if (n.startsWith(MLKIT_ASSETS)) why = "ML Kit model";
      else if (n.startsWith("base/root/")) why = rootFileOf(n.slice("base/root/".length), addedDeps);
      else if (n.startsWith("BUNDLE-METADATA/") && newSo.some((so) => n.includes(so))) why = "data of a new native library";
      if (why) allowedNew.push(`${n} (${why})`);
      else fails.push(`NEW file not from CameraX / ML Kit: ${n}`);
      continue;
    }
    compared++;
    const a = ga(), b = gb();
    if (sha(a) === sha(b)) continue;
    if (n.startsWith("base/res/") && n.endsWith(".xml") && !/^base\/res\/raw/.test(n)) {
      try {
        if (pbCanon("XmlNode", a) === pbCanon("XmlNode", b)) continue;
      } catch (e) { cannot = cannot || `${n} cannot be read (${e.message})`; continue; }
    }
    fails.push(`changed: ${n}`);
  }
  if (cannot) return { ok: false, cannot: true, lines: [`CANNOT MEASURE g) every other file: ${cannot}`, ...notes] };
  const qrFiles = allowedNew.filter((x) => x.endsWith("(sfl_qr drawable)")).length;
  return { ok: !fails.length, lines: [
    `${fails.length ? "FAIL" : "PASS"} g) every other file in the .aab: ${compared} of the base compared${fails.length ? ` — ${fails.length} problem(s)` : ", all the same"}; ${allowedNew.length} new (${qrFiles} sfl_qr drawable file(s), the rest CameraX / ML Kit)`,
    ...notes,
    ...notCompared.map((x) => `    not compared (differs in every build): ${x}`),
    ...allowedNew.slice(0, 40).map((x) => `    new ${x}`), ...(allowedNew.length > 40 ? [`    … and ${allowedNew.length - 40} more new`] : []),
    ...fails.slice(0, 60).map((f) => `  FAIL ${f}`), ...(fails.length > 60 ? [`  … and ${fails.length - 60} more`] : []),
  ] };
}
/** A new file under base/root/ is allowed when it is a new library's own version / properties / kotlin file. */
export function rootFileOf(rel, addedDeps) {
  for (const ga of addedDeps) {
    const [g, a] = ga.split(":");
    if (rel === `META-INF/${g}_${a}.version` || rel === `${a}.properties`) return `from ${ga}`;
    const km = /^META-INF\/([^/]+)\.kotlin_module$/.exec(rel);
    if (km && (km[1] === a || km[1].startsWith(`${a}_`))) return `from ${ga}`;
  }
  return null;
}

// ── the whole gate ──────────────────────────────────────────────────────────────────────────
/** Every check from ready inputs (the CLI below reads them from disk; tests pass made-up ones). */
export function runGate(i) {
  const out = [];
  const mainLibs = nativeLibs(i.mainZip), newLibs = nativeLibs(i.newZip);
  const so = checkSoHashes(mainLibs, newLibs);
  const deps = checkDeps(parseGradleDeps(i.mainDeps), parseGradleDeps(i.newDeps));
  const parts = [
    checkAbis(abisOf(mainLibs), abisOf(newLibs)),
    so,
    checkPrinterClasses(i.dex),
    deps,
    checkManifest(i.mainManifest, i.newManifest, i.newBlame),
    checkBundleEntries(i.mainZip, i.newZip, { addedDeps: deps.added, newSo: so.added }),
    checkSize({ mainCsv: i.mainSizeCsv, newCsv: i.newSizeCsv, mainAab: i.mainAabBytes, newAab: i.newAabBytes, maxMb: i.maxMb }),
    checkNewSoAlignment(newLibs, so.added),
  ];
  for (const p of parts) out.push(...p.lines, "");
  const cannot = parts.filter((p) => p.cannot).map((p) => p.lines[0].replace(/^CANNOT MEASURE /, ""));
  const failed = parts.filter((p) => !p.ok && !p.cannot).map((p) => p.lines[0].replace(/^FAIL /, ""));
  if (cannot.length) {
    out.push(`CANNOT MEASURE — STOP. ${cannot.length} check(s) could not be measured${failed.length ? ` (and ${failed.length} failed)` : ""}:`);
    for (const f of [...cannot, ...failed]) out.push(`  - ${f}`);
    return { pass: false, status: "cannot", lines: out };
  }
  out.push(failed.length ? `STOP — do not release. ${failed.length} check(s) failed:` : "RESULT: PASS — the printer code and everything it uses is the same as the base; only the scanner was added.");
  for (const f of failed) out.push(`  - ${f}`);
  return { pass: failed.length === 0, status: failed.length ? "fail" : "pass", lines: out };
}

/** Run dexdump -d -a (code + annotations) on every classes*.dex of an .aab → one text. */
export function dexdumpAab(zip, dexdump) {
  const dir = mkdtempSync(join(tmpdir(), "sfl-dex-"));
  try {
    let text = "";
    for (const [name, get] of zip) {
      if (!/^base\/dex\/classes\d*\.dex$/.test(name)) continue;
      const f = join(dir, basename(name));
      writeFileSync(f, get());
      const r = spawnSync(dexdump, ["-d", "-a", f], { maxBuffer: 2 * 1024 * 1024 * 1024, encoding: "utf8" });
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
  for (const n of need) if (!a[n] || !existsSync(a[n])) { console.log(`CANNOT MEASURE — STOP: --${n} missing (${a[n] || "not given"})`); return 2; }
  const mainBuf = readFileSync(a["main-aab"]), newBuf = readFileSync(a["new-aab"]);
  const mainZip = readZip(mainBuf), newZip = readZip(newBuf);
  const libFiles = [], libClassDescs = new Set();
  for (const n of PRINTER_LIBS) {
    const pm = join(a["main-libs"], n), pn = join(a["new-libs"], n);
    if (!existsSync(pm) || !existsSync(pn)) { console.log(`CANNOT MEASURE — STOP: printer library ${n} missing`); return 2; }
    const bm = readFileSync(pm), bn = readFileSync(pn);
    for (const [side, b] of [["main", bm], ["new", bn]]) {
      if (b.subarray(0, 40).toString().startsWith("version https://git-lfs")) { console.log(`CANNOT MEASURE — STOP: ${n} is a Git LFS pointer in the ${side} build — run "git lfs pull" in that checkout`); return 2; }
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
  return r.status === "pass" ? 0 : r.status === "cannot" ? 2 : 1;
}

// Run as a script? Compare REAL paths: on macOS $TMPDIR is /var/folders/… (a link to /private/var/…),
// so the plain string compare silently skipped the whole check (no output, exit 0) on Jeff's Mac.
function isMainModule() {
  try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}
if (isMainModule()) {
  let code = 2;
  try { code = cli(process.argv.slice(2)); } catch (e) { console.log(`CANNOT MEASURE — STOP: ${e && e.message}`); code = 2; }
  process.exit(code);
}
