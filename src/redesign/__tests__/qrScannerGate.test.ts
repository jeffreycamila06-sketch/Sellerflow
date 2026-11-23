// Printer-safety gate (mobile/android/qr-scanner-gate-check.mjs) on MADE-UP inputs: every check must turn
// FAIL on the change it exists for (a changed .so, a new chip type, a bumped library, a changed printer
// class, a new permission …) and PASS when the only change is the scanner. The real run is on Jeff's Mac.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  readZip, nativeLibs, abisOf, checkAbis, checkSoHashes, elfLoadAlign, checkNewSoAlignment, checkSize,
  parseDexdump, printerClosure, mainActivityOnlyRegistration, libClassDescriptors,
  parseGradleDeps, checkDeps, parseManifest, parseBlame, checkManifest, runGate,
} from "../../../mobile/android/qr-scanner-gate-check.mjs";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = join(ROOT, "mobile/android/qr-scanner-gate.sh");
const CHECKER = join(ROOT, "mobile/android/qr-scanner-gate-check.mjs");

// ── made-up files ───────────────────────────────────────────────────────────────────────────
/** A zip (half the entries stored, half deflated — the reader must handle both). */
function makeZip(entries: Record<string, Buffer | string>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let off = 0, i = 0;
  for (const [name, v] of Object.entries(entries)) {
    const data = Buffer.isBuffer(v) ? v : Buffer.from(v);
    const deflate = i++ % 2 === 1;
    const body = deflate ? deflateRawSync(data) : data;
    const nb = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(off, 42);
    local.push(lh, nb, body); central.push(ch, nb);
    off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
/** A small ELF shared library with one PT_LOAD segment of the given alignment. */
function makeElf(is64: boolean, align: number, fill = 0): Buffer {
  const b = Buffer.alloc(256, fill);
  b.writeUInt32BE(0x7f454c46, 0); b[4] = is64 ? 2 : 1; b[5] = 1;
  if (is64) { b.writeBigUInt64LE(64n, 0x20); b.writeUInt16LE(56, 0x36); b.writeUInt16LE(1, 0x38); b.writeUInt32LE(1, 64); b.writeBigUInt64LE(BigInt(align), 64 + 0x30); }
  else { b.writeUInt32LE(52, 0x1c); b.writeUInt16LE(32, 0x2a); b.writeUInt16LE(1, 0x2c); b.writeUInt32LE(1, 52); b.writeUInt32LE(align, 52 + 0x1c); }
  return b;
}

const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
type M = { name: string; type: string; insns: string[] };
/** dexdump -d text for one class; `v` = where it sits in that build (offsets, index numbers, line numbers). */
function dexClass(n: number, desc: string, methods: M[], v: { off: number; idx: number; line: number }) {
  const L = [`Class #${n}            -`, `  Class descriptor  : '${desc}'`, `  Access flags      : 0x0001 (PUBLIC)`, `  Superclass        : 'Ljava/lang/Object;'`, `  Interfaces        -`, `  Static fields     -`, `  Instance fields   -`, `  Direct methods    -`];
  methods.forEach((m, i) => {
    const base = v.off + i * 0x80;
    L.push(`    #${i}              : (in ${desc})`, `      name          : '${m.name}'`, `      type          : '${m.type}'`, `      access        : 0x0001 (PUBLIC)`, `      method_idx    : ${v.idx + i}`, `      code          -`, `      registers     : 3`, `      ins           : 1`, `      outs          : 2`, `      insns size    : ${m.insns.length * 2} 16-bit code units`);
    L.push(`${hex(base, 6)}:                                        |[${hex(base, 6)}] ${desc.slice(1, -1).replace(/\//g, ".")}.${m.name}:${m.type}`);
    m.insns.forEach((ins, k) => L.push(`${hex(base + 0x10 + k * 2, 6)}: 7010 ${hex(v.idx + k, 4)} 0000                         |${hex(k * 2, 4)}: ${ins.replace(/@IDX/g, hex(v.idx + k, 4))}`));
    L.push(`      catches       : (none)`, `      positions     :`, `        0x0000 line=${v.line}`, `        0x0002 line=${v.line + 1}`, `      locals        :`, `        0x0000 - 0x0004 reg=2 this ${desc}`);
  });
  L.push(`  Virtual methods   -`, `  source_file_idx   : ${v.idx} (X.java)`, ``);
  return L.join("\n");
}
const PRINTER = "Lcom/sellerflow/live/SellerFlowPrinterPlugin;";
const TSPL = "Lcom/sellerflow/live/TsplBuilder;";
const MAIN_ACT = "Lcom/sellerflow/live/MainActivity;";
const NIIM = "Lcom/gengcon/print/draw/PrintBuilder;";
const CAMERA = "Landroidx/camera/core/Preview;";
const printerM = (extra = ""): M[] => [{ name: "printSlip", type: "()V", insns: [`invoke-static {}, ${TSPL}.build:()V // method@@IDX`, `invoke-static {}, ${NIIM}.go:()V // method@@IDX`, `const-string v0, "TSPL${extra}" // string@@IDX`, "return-void"] }];
const tsplM = (n = "4"): M[] => [{ name: "build", type: "()V", insns: [`const/4 v0, #int ${n} // #${n}`, "return-void"] }];
const niimM = (): M[] => [{ name: "go", type: "()V", insns: ["return-void"] }];
const mainActM = (scanner: boolean, extra = false): M[] => [{ name: "onCreate", type: "(Landroid/os/Bundle;)V", insns: [
  `const-class v0, ${PRINTER} // type@@IDX`,
  `invoke-virtual {v2, v0}, ${MAIN_ACT}.registerPlugin:(Ljava/lang/Class;)V // method@@IDX`,
  ...(scanner ? [`const-class v0, Lcom/sellerflow/live/SellerFlowScannerPlugin; // type@@IDX`, `invoke-virtual {v2, v0}, ${MAIN_ACT}.registerPlugin:(Ljava/lang/Class;)V // method@@IDX`] : []),
  ...(extra ? [`const/4 v1, #int 1 // #1`] : []),
  `if-eqz v0, 000c // +0004`,
  "return-void",
] }];

/** A whole dexdump text for a build. `layout` moves offsets / index numbers / line numbers like a real rebuild. */
function dexdumpText(o: { layout: number; scanner: boolean; printerExtra?: string; tspl?: string; mainActExtra?: boolean }) {
  const v = (k: number) => ({ off: 0x1000 * (k + 1) + o.layout * 0x700, idx: 10 * k + o.layout * 37, line: 20 + o.layout * 3 });
  const parts = [
    `Processing 'classes.dex'...`, `Opened 'classes.dex', DEX version '035'`,
    ...(o.scanner ? [dexClass(0, CAMERA, [{ name: "x", type: "()V", insns: ["return-void"] }], v(9))] : []),
    dexClass(1, MAIN_ACT, mainActM(o.scanner, o.mainActExtra), v(1)),
    dexClass(2, PRINTER, printerM(o.printerExtra), v(2)),
    dexClass(3, TSPL, tsplM(o.tspl), v(3)),
    dexClass(4, NIIM, niimM(), v(4)),
    dexClass(5, "Lcom/sellerflow/live/R$drawable;", [{ name: "x", type: "()V", insns: [`const v0, #int ${o.scanner ? 2131 : 2130}`] }], v(5)),
  ];
  return parts.join("\n");
}

const LIBS_MAIN = { "arm64-v8a/libskia.so": makeElf(true, 16384, 1), "arm64-v8a/libminilzo.so": makeElf(true, 4096, 2), "armeabi-v7a/libskia.so": makeElf(false, 4096, 3), "armeabi-v7a/libminilzo.so": makeElf(false, 4096, 4) };
const LIBS_SCANNER = { "arm64-v8a/libbarhopper_v3.so": makeElf(true, 16384, 5), "armeabi-v7a/libbarhopper_v3.so": makeElf(false, 4096, 6) };
const aab = (libs: Record<string, Buffer>, dex = "dex") => readZip(makeZip({ "base/manifest/AndroidManifest.xml": "pb", "base/dex/classes.dex": dex, ...Object.fromEntries(Object.entries(libs).map(([k, b]) => [`base/lib/${k}`, b])) }));

const DEPS_MAIN = `
releaseRuntimeClasspath - Runtime classpath of compilation 'release' (target  (androidJvm)).
+--- androidx.appcompat:appcompat:1.7.0
|    +--- androidx.activity:activity:1.8.0 -> 1.9.2
|    |    \\--- androidx.core:core:1.13.0 -> 1.15.0 (*)
|    \\--- org.jetbrains.kotlin:kotlin-stdlib:{strictly 1.9.0} -> 1.9.0 (c)
+--- project :capacitor-android
|    \\--- androidx.core:core:1.15.0 (*)
\\--- androidx.browser:browser:1.8.0
`;
const DEPS_SCANNER = DEPS_MAIN.replace("\\--- androidx.browser:browser:1.8.0", "+--- androidx.browser:browser:1.8.0\n+--- androidx.camera:camera-core:1.5.2\n|    \\--- androidx.core:core:1.1.0 -> 1.15.0 (*)\n\\--- com.google.mlkit:barcode-scanning:17.3.0\n     \\--- com.google.android.datatransport:transport-runtime:3.1.8");

const MANIFEST_MAIN = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.sellerflow.live">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <application android:name="x" android:label="@string/app_name">
        <activity android:name="com.sellerflow.live.MainActivity" android:exported="true" />
        <provider android:name="androidx.core.content.FileProvider" android:authorities="com.sellerflow.live.fileprovider" />
    </application>
</manifest>`;
const MANIFEST_SCANNER = MANIFEST_MAIN.replace("    </application>", `        <service android:name="androidx.camera.core.impl.MetadataHolderService" android:enabled="false" android:exported="false">
            <meta-data android:name="androidx.camera.core.impl.MetadataHolderService.DEFAULT_CONFIG_PROVIDER" android:value="androidx.camera.camera2.Camera2Config$DefaultProvider" />
        </service>
        <service android:name="com.google.mlkit.common.internal.MlKitComponentDiscoveryService" android:exported="false" />
        <provider android:name="com.google.mlkit.common.internal.MlKitInitProvider" android:authorities="com.sellerflow.live.mlkitinitprovider" />
    </application>`);
const BLAME = `1<?xml version="1.0" encoding="utf-8"?>
2<manifest xmlns:android="http://schemas.android.com/apk/res/android"
40        <service
40-->[androidx.camera:camera-core:1.5.2] /Users/j/.gradle/caches/x/AndroidManifest.xml:24:9-33:19
41            android:name="androidx.camera.core.impl.MetadataHolderService"
41-->[androidx.camera:camera-core:1.5.2] /Users/j/.gradle/caches/x/AndroidManifest.xml:25:13-75
45            android:name="androidx.camera.core.impl.MetadataHolderService.DEFAULT_CONFIG_PROVIDER"
46        <service android:name="com.google.mlkit.common.internal.MlKitComponentDiscoveryService" android:exported="false" />
46-->[com.google.mlkit:common:18.11.0] /Users/j/x/AndroidManifest.xml:9:9-15:19
47        <provider android:name="com.google.mlkit.common.internal.MlKitInitProvider" android:authorities="x" />
47-->[com.google.mlkit:common:18.11.0] /Users/j/x/AndroidManifest.xml:17:9-21:39
50        <uses-permission android:name="android.permission.INTERNET" />
50-->/Users/j/sfl/mobile/android/app/src/main/AndroidManifest.xml:30:5-67
`;

function dexInputs(o: { mainText?: string; newText?: string; libFiles?: { name: string; mainHash: string; newHash: string }[] } = {}) {
  const mainClasses = parseDexdump(o.mainText ?? dexdumpText({ layout: 0, scanner: false }));
  const newClasses = parseDexdump(o.newText ?? dexdumpText({ layout: 1, scanner: true }));
  return { mainClasses, newClasses, libClassDescs: new Set([NIIM]), appRoots: [PRINTER, MAIN_ACT], libFiles: o.libFiles ?? [{ name: "image-1.9.5.aar", mainHash: "aa", newHash: "aa" }] };
}
function gate(over: Partial<Parameters<typeof runGate>[0]> = {}) {
  return runGate({
    mainZip: aab(LIBS_MAIN), newZip: aab({ ...LIBS_MAIN, ...LIBS_SCANNER }),
    mainAabBytes: 30_000_000, newAabBytes: 34_000_000,
    dex: dexInputs(), mainDeps: DEPS_MAIN, newDeps: DEPS_SCANNER,
    mainManifest: MANIFEST_MAIN, newManifest: MANIFEST_SCANNER, newBlame: BLAME,
    mainSizeCsv: "ABI,MIN,MAX\narm64-v8a,20000000,20000000\narmeabi-v7a,18000000,18000000\n",
    newSizeCsv: "ABI,MIN,MAX\narm64-v8a,23000000,23000000\narmeabi-v7a,21000000,21000000\n",
    maxMb: 6, ...over,
  });
}
const firstLine = (r: { lines: string[] }, tag: string) => r.lines.find((l) => l.startsWith(`PASS ${tag}`) || l.startsWith(`FAIL ${tag}`)) || "";

describe("the whole gate", () => {
  it("only the scanner added → every check PASS", () => {
    const r = gate();
    expect(r.pass, r.lines.join("\n")).toBe(true);
    for (const t of ["a)", "b)", "c)", "d)", "e)", "f) size", "f) 16 KB"]) expect(firstLine(r, t)).toMatch(/^PASS/);
    expect(r.lines.at(-1)).toMatch(/^RESULT: PASS/);
  });
  it("a changed native library (same name, other bytes) → FAIL b + STOP", () => {
    const r = gate({ newZip: aab({ ...LIBS_MAIN, "arm64-v8a/libminilzo.so": makeElf(true, 4096, 9), ...LIBS_SCANNER }) });
    expect(r.pass).toBe(false);
    expect(firstLine(r, "b)")).toMatch(/^FAIL b\).*arm64-v8a\/libminilzo\.so changed/);
    expect(r.lines.join("\n")).toMatch(/CHANGED arm64-v8a\/libminilzo\.so [0-9a-f]{64} → [0-9a-f]{64}/);
    expect(r.lines.find((l) => l.startsWith("STOP"))).toBe("STOP — do not release. 1 check(s) failed:");
  });
  it("a native library gone → FAIL b", () => {
    const { ["armeabi-v7a/libskia.so"]: _, ...rest } = LIBS_MAIN;
    expect(firstLine(gate({ newZip: aab({ ...rest, ...LIBS_SCANNER }) }), "b)")).toMatch(/^FAIL b\).*armeabi-v7a\/libskia\.so missing/);
  });
  it("a new chip type (x86_64 from CameraX / ML Kit) → FAIL a", () => {
    const r = gate({ newZip: aab({ ...LIBS_MAIN, ...LIBS_SCANNER, "x86_64/libbarhopper_v3.so": makeElf(true, 16384, 7) }) });
    expect(firstLine(r, "a)")).toBe("FAIL a) chip types: main [arm64-v8a, armeabi-v7a] · new [arm64-v8a, armeabi-v7a, x86_64]");
    expect(r.pass).toBe(false);
  });
  it("a bumped library version → FAIL d, listed old → new", () => {
    const r = gate({ newDeps: DEPS_SCANNER.replace("androidx.core:core:1.13.0 -> 1.15.0 (*)", "androidx.core:core:1.13.0 -> 1.16.0 (*)").replace("androidx.core:core:1.15.0 (*)", "androidx.core:core:1.15.0 -> 1.16.0 (*)").replace("androidx.core:core:1.1.0 -> 1.15.0 (*)", "androidx.core:core:1.1.0 -> 1.16.0") });
    expect(firstLine(r, "d)")).toMatch(/^FAIL d\).*1 version change/);
    expect(r.lines).toContain("  CHANGED androidx.core:core 1.15.0 → 1.16.0");
    expect(r.pass).toBe(false);
  });
  it("a printer class whose code changed → FAIL c", () => {
    const r = gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, tspl: "5" }) }) });
    expect(firstLine(r, "c)")).toMatch(/^FAIL c\)/);
    expect(r.lines).toContain(`  CHANGED ${TSPL} changed`);
  });
  it("the printer plugin itself changed → FAIL c", () => {
    expect(firstLine(gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, printerExtra: "!" }) }) }), "c)")).toMatch(/^FAIL c\)/);
  });
  it("a printer library FILE changed → FAIL c", () => {
    const r = gate({ dex: dexInputs({ libFiles: [{ name: "4.1.1-release.aar", mainHash: "aa", newHash: "bb" }] }) });
    expect(firstLine(r, "c)")).toMatch(/^FAIL c\)/);
    expect(r.lines).toContain("  CHANGED libs/4.1.1-release.aar aa → bb");
  });
  it("MainActivity changed beyond the one registration line → FAIL c", () => {
    expect(firstLine(gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, mainActExtra: true }) }) }), "c)")).toMatch(/^FAIL c\)/);
  });
  it("a new permission → FAIL e (even from ML Kit)", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace("<uses-permission android:name=\"android.permission.CAMERA\" />", "<uses-permission android:name=\"android.permission.CAMERA\" />\n    <uses-permission android:name=\"android.permission.WAKE_LOCK\" />") });
    expect(firstLine(r, "e)")).toMatch(/^FAIL e\)/);
    expect(r.lines.join("\n")).toMatch(/FAIL NEW permission android\.permission\.WAKE_LOCK/);
  });
  it("a Bluetooth permission changed → FAIL e, named as printer / Bluetooth", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('android.permission.BLUETOOTH" android:maxSdkVersion="30"', 'android.permission.BLUETOOTH" android:maxSdkVersion="33"') });
    expect(r.lines.join("\n")).toMatch(/FAIL permission changed: android\.permission\.BLUETOOTH \(printer \/ Bluetooth\)/);
  });
  it("a new service that is not CameraX / ML Kit → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace("    </application>", '        <service android:name="com.example.Tracker" />\n    </application>') });
    expect(r.lines.join("\n")).toMatch(/FAIL NEW service com\.example\.Tracker/);
  });
  it("a new uses-feature → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('android:required="false" />', 'android:required="false" />\n    <uses-feature android:name="android.hardware.camera.any" android:required="true" />') });
    expect(r.lines.join("\n")).toMatch(/FAIL NEW feature android\.hardware\.camera\.any/);
  });
  it("too big → FAIL f; a new 64-bit library not 16 KB aligned → FAIL f", () => {
    expect(firstLine(gate({ newSizeCsv: "ABI,MIN,MAX\narm64-v8a,27000000,27000000\narmeabi-v7a,21000000,21000000\n" }), "f) size")).toMatch(/^FAIL f\) size: per-phone download \+7\.0 MB/);
    const r = gate({ newZip: aab({ ...LIBS_MAIN, ...LIBS_SCANNER, "arm64-v8a/libbarhopper_v3.so": makeElf(true, 4096, 5) }) });
    expect(firstLine(r, "f) 16 KB")).toMatch(/^FAIL f\) 16 KB.*arm64-v8a\/libbarhopper_v3\.so/);
  });
  it("no bundletool → the .aab size is used", () => {
    expect(firstLine(gate({ mainSizeCsv: "", newSizeCsv: "" }), "f) size")).toMatch(/^PASS f\) size: \.aab 30\.0 → 34\.0 MB/);
  });
});

describe("the pieces", () => {
  it("zip reader: stored + deflated entries", () => {
    const z = readZip(makeZip({ a: "hello", b: "world world world" }));
    expect(z.get("a")!().toString()).toBe("hello");
    expect(z.get("b")!().toString()).toBe("world world world");
  });
  it("native libraries, chip types, ELF alignment", () => {
    const libs = nativeLibs(aab(LIBS_MAIN));
    expect(abisOf(libs)).toEqual(["arm64-v8a", "armeabi-v7a"]);
    expect(elfLoadAlign(makeElf(true, 16384))).toEqual({ is64: true, align: 16384 });
    expect(elfLoadAlign(makeElf(false, 4096))).toEqual({ is64: false, align: 4096 });
    expect(elfLoadAlign(Buffer.from("not elf"))).toBeNull();
    expect(checkAbis(["a"], ["a"]).ok).toBe(true);
    expect(checkSoHashes(libs, libs).ok).toBe(true);
    expect(checkNewSoAlignment(nativeLibs(aab(LIBS_SCANNER)), ["armeabi-v7a/libbarhopper_v3.so"]).ok).toBe(true); // 32-bit: no 16 KB rule
    expect(checkSize({ mainCsv: "", newCsv: "", mainAab: 1e6, newAab: 7.5e6, maxMb: 6 }).ok).toBe(false);
  });
  it("dexdump: a class that did not change reads the same in two builds (offsets, index numbers, line numbers removed)", () => {
    const a = parseDexdump(dexdumpText({ layout: 0, scanner: false }));
    const b = parseDexdump(dexdumpText({ layout: 3, scanner: true }));
    for (const d of [PRINTER, TSPL, NIIM]) expect(b.get(d)!.text).toBe(a.get(d)!.text);
    expect(a.get(PRINTER)!.text).not.toMatch(/@[0-9a-f]{4}|line=|\[0/);
    expect(a.get(PRINTER)!.refs.has(TSPL)).toBe(true);
    expect(a.get(MAIN_ACT)!.text).not.toBe(b.get(MAIN_ACT)!.text);
  });
  it("closure: printer plugin → TsplBuilder + the Niimbot class; R classes left out; nothing of the scanner", () => {
    const a = parseDexdump(dexdumpText({ layout: 0, scanner: false }));
    expect([...printerClosure(a, [PRINTER, MAIN_ACT])].sort()).toEqual([NIIM, MAIN_ACT, PRINTER, TSPL].sort());
  });
  it("MainActivity: only the scanner registration added → allowed; anything more → not", () => {
    const t = (o: { scanner: boolean; extra?: boolean; layout: number }) => parseDexdump(dexdumpText({ ...o, mainActExtra: o.extra })).get(MAIN_ACT)!.text;
    expect(mainActivityOnlyRegistration(t({ scanner: false, layout: 0 }), t({ scanner: true, layout: 2 }))).toBe(true);
    expect(mainActivityOnlyRegistration(t({ scanner: false, layout: 0 }), t({ scanner: true, extra: true, layout: 2 }))).toBe(false);
    expect(mainActivityOnlyRegistration(t({ scanner: false, layout: 0 }), t({ scanner: false, extra: true, layout: 2 }))).toBe(false);
  });
  it("printer library classes are read out of the .aar's classes.jar and out of a .jar", () => {
    const jar = makeZip({ "com/gengcon/print/draw/PrintBuilder.class": "x", "META-INF/MANIFEST.MF": "m" });
    expect([...libClassDescriptors("4.1.1-release.aar", makeZip({ "classes.jar": jar, "jni/arm64-v8a/libminilzo.so": "so" }))]).toEqual([NIIM]);
    expect([...libClassDescriptors("LPAPI-2019-11-20-R.jar", jar)]).toEqual([NIIM]);
  });
  it("gradle dependencies: resolved versions; constraints and projects skipped", () => {
    const m = parseGradleDeps(DEPS_MAIN);
    expect(Object.fromEntries(m)).toEqual({ "androidx.appcompat:appcompat": "1.7.0", "androidx.activity:activity": "1.9.2", "androidx.core:core": "1.15.0", "androidx.browser:browser": "1.8.0" });
    expect(checkDeps(m, parseGradleDeps(DEPS_SCANNER)).ok).toBe(true);
    expect(checkDeps(new Map(), new Map()).ok).toBe(false); // an empty list must not pass
  });
  it("manifest + merge report", () => {
    const p = parseManifest(MANIFEST_SCANNER);
    expect(p.components.has("service androidx.camera.core.impl.MetadataHolderService")).toBe(true);
    expect(p.metas.has("androidx.camera.core.impl.MetadataHolderService.DEFAULT_CONFIG_PROVIDER")).toBe(true);
    const b = parseBlame(BLAME);
    expect(b.get("service androidx.camera.core.impl.MetadataHolderService")).toBe("androidx.camera:camera-core");
    expect(b.get("provider com.google.mlkit.common.internal.MlKitInitProvider")).toBe("com.google.mlkit:common");
    expect(b.get("android.permission.INTERNET")).toBe("app");
    const r = checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, BLAME);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/service androidx\.camera\.core\.impl\.MetadataHolderService \(from androidx\.camera:camera-core\)/);
    // the merge report says a "camera-looking" service came from somewhere else → not allowed
    const lie = BLAME.replace("[androidx.camera:camera-core:1.5.2] /Users/j/.gradle/caches/x/AndroidManifest.xml:24:9-33:19", "[com.example:spy:1.0] /x:1:1");
    expect(checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, lie).ok).toBe(false);
  });
});

// ── the real checker as a program, on made-up files + a fake dexdump ────────────────────────
describe("the checker program", () => {
  const dir = mkdtempSync(join(tmpdir(), "sfl-gate-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fakeDexdump = join(dir, "dexdump");
  writeFileSync(fakeDexdump, '#!/bin/sh\n# fake dexdump: the test "dex" files hold dexdump text already\ncat "$2"\n');
  chmodSync(fakeDexdump, 0o755);
  const jar = makeZip({ "com/gengcon/print/draw/PrintBuilder.class": "x" });
  function setup(name: string, o: { newText?: string; lfs?: boolean; newLibs?: Record<string, Buffer> } = {}) {
    const d = join(dir, name);
    for (const s of ["main", "new"]) {
      mkdirSync(join(d, s, "libs"), { recursive: true });
      writeFileSync(join(d, s, "libs/4.1.1-release.aar"), o.lfs && s === "new" ? "version https://git-lfs.github.com/spec/v1\n" : makeZip({ "classes.jar": jar }));
      writeFileSync(join(d, s, "libs/image-1.9.5.aar"), makeZip({ "classes.jar": makeZip({ "a/B.class": "y" }) }));
      writeFileSync(join(d, s, "libs/LPAPI-2019-11-20-R.jar"), makeZip({ "c/D.class": "z" }));
    }
    writeFileSync(join(d, "main.aab"), makeZip({ "base/dex/classes.dex": dexdumpText({ layout: 0, scanner: false }), ...Object.fromEntries(Object.entries(LIBS_MAIN).map(([k, b]) => [`base/lib/${k}`, b])) }));
    writeFileSync(join(d, "new.aab"), makeZip({ "base/dex/classes.dex": o.newText ?? dexdumpText({ layout: 1, scanner: true }), ...Object.fromEntries(Object.entries(o.newLibs ?? { ...LIBS_MAIN, ...LIBS_SCANNER }).map(([k, b]) => [`base/lib/${k}`, b])) }));
    writeFileSync(join(d, "main.deps"), DEPS_MAIN); writeFileSync(join(d, "new.deps"), DEPS_SCANNER);
    writeFileSync(join(d, "main.xml"), MANIFEST_MAIN); writeFileSync(join(d, "new.xml"), MANIFEST_SCANNER); writeFileSync(join(d, "blame.txt"), BLAME);
    return spawnSync("node", [CHECKER, "--main-aab", join(d, "main.aab"), "--new-aab", join(d, "new.aab"), "--main-deps", join(d, "main.deps"), "--new-deps", join(d, "new.deps"),
      "--main-manifest", join(d, "main.xml"), "--new-manifest", join(d, "new.xml"), "--new-blame", join(d, "blame.txt"),
      "--main-libs", join(d, "main/libs"), "--new-libs", join(d, "new/libs"), "--dexdump", fakeDexdump, "--max-mb", "6"], { encoding: "utf8" });
  }
  it("only the scanner → exit 0, RESULT: PASS", () => {
    const r = setup("ok");
    expect(r.stdout).toMatch(/RESULT: PASS/);
    expect(r.status).toBe(0);
  });
  it("a printer class changed → exit 1, STOP", () => {
    const r = setup("tspl", { newText: dexdumpText({ layout: 1, scanner: true, tspl: "7" }) });
    expect(r.stdout).toMatch(/STOP — do not release/);
    expect(r.status).toBe(1);
  });
  it("a changed .so → exit 1", () => {
    expect(setup("so", { newLibs: { ...LIBS_MAIN, "armeabi-v7a/libskia.so": makeElf(false, 4096, 8), ...LIBS_SCANNER } }).status).toBe(1);
  });
  it("a printer library still a Git LFS pointer → exit 2, CANNOT MEASURE (never a PASS)", () => {
    const r = setup("lfs", { lfs: true });
    expect(r.stdout).toMatch(/CANNOT MEASURE: 4\.1\.1-release\.aar is a Git LFS pointer in the new build/);
    expect(r.status).toBe(2);
  });
});

describe("the shell script (it runs only on the Mac — its rules are pinned here)", () => {
  const sh = readFileSync(SCRIPT, "utf8");
  const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("builds main and this commit in two NEW worktrees, never in this checkout or ~/Sellerflow", () => {
    expect(code).toContain('git -C "$ROOT" worktree add -q --detach "$WORK/main" "$MAIN_SHA"');
    expect(code).toContain('git -C "$ROOT" worktree add -q --detach "$WORK/new" "$NEW_SHA"');
    expect(code).not.toMatch(/\bgit (-C "[^"]*" )?(checkout|switch|reset|stash|clean|restore)\b/);
    expect(code).not.toMatch(/cd "\$ROOT\/mobile/);
    expect(code).not.toMatch(/\$HOME\/Sellerflow\/[^"\n]*(gradlew|npm|cap sync)/);
    // ~/Sellerflow is only READ for the key file / SDK path
    expect((code.match(/\$HOME\/Sellerflow/g) || []).length).toBe(2);
    expect(code).toContain('worktree remove --force "$wt"');
  });
  it("release build, the release classpath, every check input passed to the checker", () => {
    expect(code).toContain("clean bundleRelease");
    expect(code).toContain(":app:dependencies --configuration releaseRuntimeClasspath");
    for (const a of ["--main-aab", "--new-aab", "--main-deps", "--new-deps", "--main-manifest", "--new-manifest", "--main-libs", "--new-libs", "--dexdump", "--max-mb"]) expect(code).toContain(a);
    expect(code).toContain('die "keystore.properties not found');
    expect(code).toContain('die "dexdump not found');
  });
  it("safe on the Mac's bash 3.2 (empty arrays) and stops on the checker's exit code", () => {
    expect(code).toContain('${SIZE_ARGS[@]+"${SIZE_ARGS[@]}"}');
    expect(code).toContain('${BLAME_ARGS[@]+"${BLAME_ARGS[@]}"}');
    expect(code).toContain("code=${PIPESTATUS[0]}");
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });
});
