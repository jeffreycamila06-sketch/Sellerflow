// Printer-safety gate (mobile/android/qr-scanner-gate-check.mjs) on MADE-UP inputs: every check must turn
// FAIL on the change it exists for (a changed .so, a new chip type, a bumped library, a changed printer
// class, a new permission …) and PASS when the only change is the scanner. The real run is on Jeff's Mac.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  readZip, nativeLibs, abisOf, checkAbis, checkSoHashes, elfLoadAlign, checkNewSoAlignment, checkSize,
  parseDexdump, printerClosure, mainActivityOnlyRegistration, libClassDescriptors,
  parseGradleDeps, checkDeps, parseBlame, checkManifest, runGate, parseXml, canonXml,
  pbFields, pbCanon, resourceEntries, checkBundleEntries, rootFileOf, EXPECTED_DIFF,
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
function dexClass(n: number, desc: string, methods: M[], v: { off: number; idx: number; line: number }, annos?: { cls?: string[]; method?: Record<string, string[]> }) {
  const A: string[] = [];
  if (annos) {
    A.push(`Class #${n} annotations:`);
    if (annos.cls) A.push("Annotations on class", ...annos.cls.map((x) => `  ${x}`));
    methods.forEach((m, i) => { const l = annos.method?.[m.name]; if (l) A.push(`Annotations on method #${v.idx + 100 + i} '${m.name}'`, ...l.map((x) => `  ${x}`)); });
    A.push("");
  }
  const L = [...A, `Class #${n}            -`, `  Class descriptor  : '${desc}'`, `  Access flags      : 0x0001 (PUBLIC)`, `  Superclass        : 'Ljava/lang/Object;'`, `  Interfaces        -`, `  Static fields     -`, `  Instance fields   -`, `  Direct methods    -`];
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

const PRINTER_ANNOS = (o: { returnType?: string; name?: string } = {}) => ({
  cls: [`VISIBILITY_RUNTIME Lcom/getcapacitor/annotation/CapacitorPlugin; name="${o.name ?? "SellerFlowPrinter"}" permissions={ }`],
  method: { printSlip: [`VISIBILITY_RUNTIME Lcom/getcapacitor/PluginMethod; returnType="${o.returnType ?? "promise"}"`] },
});
/** A whole dexdump -d -a text for a build. `layout` moves offsets / index numbers / line numbers like a real rebuild. */
function dexdumpText(o: { layout: number; scanner: boolean; printerExtra?: string; tspl?: string; mainActExtra?: boolean; returnType?: string; pluginName?: string; noAnnos?: boolean; printerFirst?: boolean }) {
  const v = (k: number) => ({ off: 0x1000 * (k + 1) + o.layout * 0x700, idx: 10 * k + o.layout * 37, line: 20 + o.layout * 3 });
  const printer = dexClass(2, PRINTER, printerM(o.printerExtra), v(2), o.noAnnos ? undefined : PRINTER_ANNOS({ returnType: o.returnType, name: o.pluginName }));
  const mainAct = dexClass(1, MAIN_ACT, mainActM(o.scanner, o.mainActExtra), v(1));
  const parts = [
    `Processing 'classes.dex'...`, `Opened 'classes.dex', DEX version '035'`,
    ...(o.scanner ? [dexClass(0, CAMERA, [{ name: "x", type: "()V", insns: ["return-void"] }], v(9), { cls: ["VISIBILITY_RUNTIME Landroidx/annotation/RequiresApi; value=21"] })] : []),
    ...(o.printerFirst ? [printer, mainAct] : [mainAct, printer]),
    dexClass(3, TSPL, tsplM(o.tspl), v(3)),
    dexClass(4, NIIM, niimM(), v(4)),
    dexClass(5, "Lcom/sellerflow/live/R$drawable;", [{ name: "x", type: "()V", insns: [`const v0, #int ${o.scanner ? 2131 : 2130}`] }], v(5)),
  ];
  return parts.join("\n");
}

// ── made-up protobuf (aapt2 Resources.proto field numbers) ──────────────────────────────────
type PbV = number | bigint | string | Buffer;
const pbVar = (n: number | bigint) => { let v = BigInt(n); const out: number[] = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return Buffer.from(out); };
/** fields: [no, value] — number/bigint = varint, string/Buffer = bytes. */
function pb(fields: [number, PbV][]): Buffer {
  return Buffer.concat(fields.map(([no, v]) => {
    if (typeof v === "number" || typeof v === "bigint") return Buffer.concat([pbVar((no << 3) | 0), pbVar(v)]);
    const b = Buffer.isBuffer(v) ? v : Buffer.from(v);
    return Buffer.concat([pbVar((no << 3) | 2), pbVar(b.length), b]);
  }));
}
const SRC = (line: number) => pb([[1, 3], [2, pb([[1, line]])]]); // Source{path_idx, position{line}}
const REF = (name: string, id: number) => pb([[2, id], [3, name]]); // Reference{id, name}
const ITEM_STR = (s: string) => pb([[2, pb([[1, s]])]]);
const ITEM_REF = (name: string, id: number) => pb([[1, REF(name, id)]]);
const ITEM_FILE = (path: string) => pb([[5, pb([[1, path], [2, 1]])]]);
const VAL = (item: Buffer, line = 1) => pb([[1, SRC(line)], [2, "a comment"], [4, item]]);
const CV = (value: Buffer) => pb([[1, pb([])], [2, value]]);
const ENTRY = (id: number, name: string, ...cvs: Buffer[]) => pb([[1, pb([[1, id]])], [2, name], ...cvs.map((c) => [6, c] as [number, PbV])]);
const TYPE = (id: number, name: string, entries: Buffer[]) => pb([[1, pb([[1, id]])], [2, name], ...entries.map((e) => [3, e] as [number, PbV])]);
const STYLE = (parent: Buffer, entries: [Buffer, Buffer][], line = 1) => pb([[1, SRC(line)], [5, pb([[2, pb([[1, parent], [2, SRC(line)], ...entries.map(([k, it]) => [3, pb([[1, SRC(line)], [3, k], [4, it]])] as [number, PbV])])]])]]);
/** A resource table. `shift` moves every app resource number (as adding a resource does); `extra` = new entries. */
function resTable(o: { shift?: number; appName?: string; extra?: { type: string; entries: Buffer[] }[]; removeSplash?: boolean; pool?: string; style?: "same" | "changed" } = {}) {
  const k = o.shift || 0;
  const id = (t: number, e: number) => 0x7f000000 + (t << 16) + e + k;
  const types: Record<string, Buffer[]> = {
    attr: [ENTRY(0, "colorMain", CV(pb([[5, pb([[1, pb([[1, 0x10]])]])]])))],
    color: [ENTRY(0, "main", CV(VAL(pb([[7, pb([[6, 0xff4f46e5]])]]), 3)))],
    drawable: [ENTRY(0, "a_icon", CV(VAL(ITEM_FILE("res/drawable/a_icon.xml")))), ...(o.removeSplash ? [] : [ENTRY(1 + k, "splash", CV(VAL(ITEM_FILE("res/drawable/splash.png"))))])],
    string: [ENTRY(0, "app_name", CV(VAL(ITEM_STR(o.appName ?? "SellerFlowLive"), 7 + k)))],
    style: [ENTRY(0, "AppTheme", CV(STYLE(REF("style/Base", id(9, 0)), o.style === "changed"
      ? [[REF("attr/colorMain", id(1, 0)), ITEM_REF("color/other", id(2, 1))]]
      : (k
        ? [[REF("android:attr/windowBackground", 0x01010054), ITEM_REF("drawable/splash", id(3, 1))], [REF("attr/colorMain", id(1, 0)), ITEM_REF("color/main", id(2, 0))]]
        : [[REF("attr/colorMain", id(1, 0)), ITEM_REF("color/main", id(2, 0))], [REF("android:attr/windowBackground", 0x01010054), ITEM_REF("drawable/splash", id(3, 1))]]) as [Buffer, Buffer][], 4 + k)))],
  };
  for (const x of o.extra || []) types[x.type] = [...(types[x.type] || []), ...x.entries];
  const typeBufs = Object.entries(types).map(([t, es], i) => TYPE(i + 1 + (k ? 1 : 0), t, es));
  return pb([[1, pb([[1, o.pool ?? "/Users/j/sfl-wt/main/res/values.xml"]])], [2, pb([[1, pb([[1, 0x7f]])], [2, "com.sellerflow.live"], ...typeBufs.map((t) => [3, t] as [number, PbV])])], [4, pb([[1, "Android Asset Packaging Tool (aapt)"], [2, "2.19-" + (k ? "b" : "a")]])]]);
}
/** A compiled res XML (XmlNode). Attribute order follows resource numbers in aapt2 — so it moves with `shift`. */
function resXml(o: { shift?: number; tint?: string; width?: string } = {}) {
  const k = o.shift || 0;
  const attr = (name: string, value: string, rid: number, item?: Buffer) => pb([[1, "http://schemas.android.com/apk/res/android"], [2, name], [3, value], [4, pb([[1, 2]])], [5, rid], ...(item ? [[6, item] as [number, PbV]] : [])]);
  const width = attr("width", o.width ?? "24dp", 0x01010159, pb([[7, pb([[3, 24]])]]));
  const tint = attr("tint", o.tint ?? "@color/main", 0x7f040001 + k, ITEM_REF(`color/${(o.tint ?? "@color/main").split("/")[1]}`, 0x7f050000 + k));
  const attrs = k ? [tint, width] : [width, tint];
  const child = pb([[1, pb([[3, "path"], [4, attr("pathData", "M0 0h24v24H0z", 0x01010405)]])], [3, pb([[1, 3]])]]);
  return pb([[1, pb([[1, pb([[1, "android"], [2, "http://schemas.android.com/apk/res/android"]])], [3, "vector"], ...attrs.map((a) => [4, a] as [number, PbV]), [5, child]])], [3, pb([[1, 1]])]]);
}
const QR_RES = ["sfl_qr_close", "sfl_qr_light_off", "sfl_qr_light_on"];
/** Every other entry of a made-up .aab (assets, res, resources.pb, root, BundleConfig). */
function bundleOther(side: "main" | "new", over: Record<string, Buffer | string | null> = {}) {
  const isNew = side === "new";
  const shift = isNew ? 3 : 0;
  const files: Record<string, Buffer | string | null> = {
    "BundleConfig.pb": pb([[1, pb([[1, "1.17.2"]])]]),
    "BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb": isNew ? "deps-new" : "deps-main",
    "BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties": "appMetadataVersion=1.1\nandroidGradlePluginVersion=8.13.0\n",
    "META-INF/MANIFEST.MF": isNew ? "signed new" : "signed main",
    "META-INF/UPLOAD.SF": isNew ? "sf new" : "sf main",
    "META-INF/UPLOAD.RSA": isNew ? "rsa new" : "rsa main",
    "base/assets/capacitor.config.json": '{"appId":"com.sellerflow.live","server":{"url":"https://www.sellerflowlive.com/?apk=20260523-dark-mobile"}}',
    "base/assets/capacitor.plugins.json": "[]",
    "base/assets/public/index.html": "<!doctype html><title>x</title>",
    "base/res/drawable/a_icon.xml": resXml({ shift }),
    "base/res/drawable/splash.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    "base/root/META-INF/androidx.core_core.version": "1.15.0",
    "base/root/kotlin/kotlin.kotlin_builtins": "kb",
    "base/native.pb": pb([[1, "lib/arm64-v8a"], [1, "lib/armeabi-v7a"]]),
    "base/resources.pb": isNew
      ? resTable({ shift, pool: "/private/tmp/sfl-qr-gate.ab12/new/res/values.xml", extra: [
          { type: "drawable", entries: QR_RES.map((n, i) => ENTRY(10 + i, n, CV(VAL(ITEM_FILE(`res/drawable/${n}.xml`))))) },
          { type: "string", entries: [ENTRY(5, "common_google_play_services_unknown_issue", CV(VAL(ITEM_STR("%1$s is having trouble"))))] },
        ] })
      : resTable(),
  };
  if (isNew) {
    for (const n of QR_RES) files[`base/res/drawable/${n}.xml`] = resXml({ tint: "@color/main" });
    files["base/assets/mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite"] = "model";
    files["base/root/META-INF/androidx.camera_camera-core.version"] = "1.5.2";
    files["base/root/transport-runtime.properties"] = "version=3.1.8";
  }
  for (const [k, v] of Object.entries(over)) files[k] = v;
  return Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)) as Record<string, Buffer | string>;
}

const LIBS_MAIN = { "arm64-v8a/libskia.so": makeElf(true, 16384, 1), "arm64-v8a/libminilzo.so": makeElf(true, 4096, 2), "armeabi-v7a/libskia.so": makeElf(false, 4096, 3), "armeabi-v7a/libminilzo.so": makeElf(false, 4096, 4) };
const LIBS_SCANNER = { "arm64-v8a/libbarhopper_v3.so": makeElf(true, 16384, 5), "armeabi-v7a/libbarhopper_v3.so": makeElf(false, 4096, 6) };
const aabFiles = (libs: Record<string, Buffer>, side: "main" | "new" = "main", over: Record<string, Buffer | string | null> = {}, dex = "dex") =>
  makeZip({ "base/manifest/AndroidManifest.xml": `pb-${side}`, "base/dex/classes.dex": dex, ...Object.fromEntries(Object.entries(libs).map(([k, b]) => [`base/lib/${k}`, b])), ...bundleOther(side, over) });
const aab = (libs: Record<string, Buffer>, side: "main" | "new" = "main", over: Record<string, Buffer | string | null> = {}) => readZip(aabFiles(libs, side, over));
const NEW_LIBS = { ...LIBS_MAIN, ...LIBS_SCANNER };

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
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.sellerflow.live" android:versionCode="10" android:versionName="1.9">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <application android:name="x" android:label="@string/app_name">
        <activity android:name="com.sellerflow.live.MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <provider android:name="androidx.core.content.FileProvider" android:authorities="com.sellerflow.live.fileprovider" />
    </application>
</manifest>`;
const MANIFEST_SCANNER = MANIFEST_MAIN.replace('android:versionCode="10" android:versionName="1.9"', 'android:versionCode="11" android:versionName="1.10"').replace("    </application>", `        <service android:name="androidx.camera.core.impl.MetadataHolderService" android:enabled="false" android:exported="false">
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
    mainZip: aab(LIBS_MAIN), newZip: aab(NEW_LIBS, "new"),
    mainAabBytes: 30_000_000, newAabBytes: 34_000_000,
    dex: dexInputs(), mainDeps: DEPS_MAIN, newDeps: DEPS_SCANNER,
    mainManifest: MANIFEST_MAIN, newManifest: MANIFEST_SCANNER, newBlame: BLAME,
    mainSizeCsv: "ABI,MIN,MAX\narm64-v8a,20000000,20000000\narmeabi-v7a,18000000,18000000\n",
    newSizeCsv: "ABI,MIN,MAX\narm64-v8a,23000000,23000000\narmeabi-v7a,21000000,21000000\n",
    maxMb: 6, ...over,
  });
}
const firstLine = (r: { lines: string[] }, tag: string) => r.lines.find((l) => l.startsWith(`PASS ${tag}`) || l.startsWith(`FAIL ${tag}`) || l.startsWith(`CANNOT MEASURE ${tag}`)) || "";
const all = (r: { lines: string[] }) => r.lines.join("\n");

describe("the whole gate", () => {
  it("only the scanner added → every check PASS", () => {
    const r = gate();
    expect(r.pass, r.lines.join("\n")).toBe(true);
    expect(r.status).toBe("pass");
    for (const t of ["a)", "b)", "c)", "d)", "e)", "g)", "f) size", "f) 16 KB"]) expect(firstLine(r, t)).toMatch(/^PASS/);
    expect(r.lines.at(-1)).toMatch(/^RESULT: PASS/);
  });
  it("a changed native library (same name, other bytes) → FAIL b + STOP", () => {
    const r = gate({ newZip: aab({ ...LIBS_MAIN, "arm64-v8a/libminilzo.so": makeElf(true, 4096, 9), ...LIBS_SCANNER }, "new") });
    expect(r.pass).toBe(false);
    expect(firstLine(r, "b)")).toMatch(/^FAIL b\).*arm64-v8a\/libminilzo\.so changed/);
    expect(r.lines.join("\n")).toMatch(/CHANGED arm64-v8a\/libminilzo\.so [0-9a-f]{64} → [0-9a-f]{64}/);
    expect(r.lines.find((l) => l.startsWith("STOP"))).toBe("STOP — do not release. 1 check(s) failed:");
  });
  it("a native library gone → FAIL b", () => {
    const { ["armeabi-v7a/libskia.so"]: _, ...rest } = LIBS_MAIN;
    expect(firstLine(gate({ newZip: aab({ ...rest, ...LIBS_SCANNER }, "new") }), "b)")).toMatch(/^FAIL b\).*armeabi-v7a\/libskia\.so missing/);
  });
  it("a new chip type (x86_64 from CameraX / ML Kit) → FAIL a", () => {
    const r = gate({ newZip: aab({ ...NEW_LIBS, "x86_64/libbarhopper_v3.so": makeElf(true, 16384, 7) }, "new") });
    expect(firstLine(r, "a)")).toBe("FAIL a) chip types: base [arm64-v8a, armeabi-v7a] · new [arm64-v8a, armeabi-v7a, x86_64]");
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
    expect(all(r)).toMatch(/FAIL NEW <uses-permission android\.permission\.WAKE_LOCK> \(a new permission\)/);
  });
  it("a Bluetooth permission changed → FAIL e, named as printer / Bluetooth", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('android.permission.BLUETOOTH" android:maxSdkVersion="30"', 'android.permission.BLUETOOTH" android:maxSdkVersion="33"') });
    expect(all(r)).toMatch(/FAIL removed or changed: <uses-permission android\.permission\.BLUETOOTH> \(printer \/ Bluetooth\)/);
  });
  it("a new service that is not CameraX / ML Kit → FAIL e", () => {
    const r = gate({
      newManifest: MANIFEST_SCANNER.replace("    </application>", '        <service android:name="com.example.Tracker" />\n    </application>'),
      newBlame: BLAME + '60        <service android:name="com.example.Tracker" />\n60-->[com.example:spy:1.0] /x/AndroidManifest.xml:3:9-60\n',
    });
    expect(all(r)).toMatch(/FAIL NEW service com\.example\.Tracker \(from com\.example:spy\) — not a CameraX \/ ML Kit part/);
    expect(r.status).toBe("fail");
  });
  it("a new uses-feature → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('android:required="false" />', 'android:required="false" />\n    <uses-feature android:name="android.hardware.camera.any" android:required="true" />') });
    expect(all(r)).toMatch(/FAIL NEW <uses-feature android\.hardware\.camera\.any>/);
  });
  it("too big → FAIL f; a new 64-bit library not 16 KB aligned → FAIL f", () => {
    expect(firstLine(gate({ newSizeCsv: "ABI,MIN,MAX\narm64-v8a,27000000,27000000\narmeabi-v7a,21000000,21000000\n" }), "f) size")).toMatch(/^FAIL f\) size: per-phone download \+7\.0 MB/);
    const r = gate({ newZip: aab({ ...NEW_LIBS, "arm64-v8a/libbarhopper_v3.so": makeElf(true, 4096, 5) }, "new") });
    expect(firstLine(r, "f) 16 KB")).toMatch(/^FAIL f\) 16 KB.*arm64-v8a\/libbarhopper_v3\.so/);
  });
  it("no bundletool → the .aab size is used", () => {
    expect(firstLine(gate({ mainSizeCsv: "", newSizeCsv: "" }), "f) size")).toMatch(/^PASS f\) size: \.aab 30\.0 → 34\.0 MB/);
  });
});
describe("Fix Round 3 rules — each one turns FAIL / CANNOT MEASURE", () => {
  // c) annotations (dexdump -a)
  it("an annotation changed (@PluginMethod returnType) → FAIL c", () => {
    const r = gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, returnType: "none" }) }) });
    expect(firstLine(r, "c)")).toMatch(/^FAIL c\)/);
    expect(r.lines).toContain(`  CHANGED ${PRINTER} changed`);
  });
  it("the @CapacitorPlugin name changed → FAIL c; annotations gone → FAIL c", () => {
    expect(firstLine(gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, pluginName: "Printer2" }) }) }), "c)")).toMatch(/^FAIL c\)/);
    expect(firstLine(gate({ dex: dexInputs({ newText: dexdumpText({ layout: 1, scanner: true, noAnnos: true }) }) }), "c)")).toMatch(/^FAIL c\)/);
  });
  it("annotations belong to their own class, wherever it sits in the dex (moved class + new index numbers → same)", () => {
    const r = gate({ dex: dexInputs({ newText: dexdumpText({ layout: 2, scanner: true, printerFirst: true }) }) });
    expect(firstLine(r, "c)")).toMatch(/^PASS c\)/);
    const p = parseDexdump(dexdumpText({ layout: 0, scanner: false })).get(PRINTER)!.text;
    expect(p).toMatch(/anno +VISIBILITY_RUNTIME Lcom\/getcapacitor\/PluginMethod; returnType="promise"/);
    expect(p).toMatch(/anno Annotations on method 'printSlip'/);
    expect(p).not.toMatch(/Annotations on method #/);
    expect(parseDexdump(dexdumpText({ layout: 0, scanner: false })).get(MAIN_ACT)!.text).not.toMatch(/PluginMethod/);
  });
  // e) the whole manifest
  it("LAUNCHER removed from MainActivity → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('                <category android:name="android.intent.category.LAUNCHER" />\n', "") });
    expect(firstLine(r, "e)")).toMatch(/^FAIL e\)/);
    expect(all(r)).toMatch(/removed or changed in <application>: <activity com\.sellerflow\.live\.MainActivity>/);
  });
  it("a new intent-filter on an existing activity → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace("            </intent-filter>\n", '            </intent-filter>\n            <intent-filter><action android:name="android.intent.action.VIEW" /></intent-filter>\n') });
    expect(firstLine(r, "e)")).toMatch(/^FAIL e\)/);
  });
  it("a new <uses-library> → FAIL e (even inside <application>)", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace("    </application>", '        <uses-library android:name="org.apache.http.legacy" android:required="false" />\n    </application>') });
    expect(all(r)).toMatch(/FAIL NEW uses-library org\.apache\.http\.legacy in <application>/);
  });
  it("a new permission declaration → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace("    <uses-sdk", '    <permission android:name="com.sellerflow.live.SPY" android:protectionLevel="normal" />\n    <uses-sdk') });
    expect(all(r)).toMatch(/FAIL NEW <permission com\.sellerflow\.live\.SPY>/);
  });
  it("an application setting changed → FAIL e", () => {
    const r = gate({ newManifest: MANIFEST_SCANNER.replace('<application android:name="x"', '<application android:name="x" android:allowBackup="true"') });
    expect(all(r)).toMatch(/FAIL application setting android:allowBackup changed: \(none\) → true/);
  });
  it("an empty manifest (either side) → FAIL e", () => {
    expect(firstLine(gate({ newManifest: "" }), "e)")).toMatch(/^FAIL e\)/);
    expect(all(gate({ mainManifest: "  " }))).toMatch(/FAIL the base manifest is empty/);
  });
  it("<application> or BLUETOOTH_CONNECT missing → FAIL e", () => {
    const noBt = MANIFEST_SCANNER.replace('    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />\n', "");
    expect(all(gate({ newManifest: noBt }))).toMatch(/FAIL no BLUETOOTH_CONNECT permission in the new manifest/);
    const noApp = MANIFEST_SCANNER.replace(/<application[\s\S]*<\/application>/, "");
    expect(all(gate({ newManifest: noApp }))).toMatch(/FAIL no <application> in the new manifest/);
  });
  it("only the version may change on <manifest>; package changed → FAIL e", () => {
    expect(all(gate())).toMatch(/version: android:versionCode 10 → 11/);
    expect(all(gate({ newManifest: MANIFEST_SCANNER.replace('package="com.sellerflow.live"', 'package="com.other"') }))).toMatch(/FAIL <manifest> package changed/);
  });
  // d) unreadable dependency lines
  it("a dependency line it cannot read ({require …}, FAILED, (n), reject) → CANNOT MEASURE — STOP", () => {
    for (const bad of ["+--- a.b:c:{require 1.0} -> 1.2", "+--- a.b:c:{require 1.0; reject 2.0} -> 1.0", "+--- a.b:c:1.0 FAILED", "+--- a.b:c:1.0 (n)", "+--- something odd"]) {
      const r = gate({ newDeps: DEPS_SCANNER + bad + "\n" });
      expect(r.status, bad).toBe("cannot");
      expect(firstLine(r, "d)"), bad).toMatch(/^CANNOT MEASURE d\)/);
      expect(r.lines.find((l) => l.startsWith("CANNOT MEASURE — STOP"))).toBeTruthy();
      expect(r.pass).toBe(false);
    }
    expect(gate({ mainDeps: "nothing here" }).status).toBe("cannot");
  });
  // g) every other file
  it("capacitor.config.json changed → FAIL g, named", () => {
    const r = gate({ newZip: aab(NEW_LIBS, "new", { "base/assets/capacitor.config.json": '{"appId":"com.sellerflow.live","server":{"url":"https://preview.vercel.app"}}' }) });
    expect(firstLine(r, "g)")).toMatch(/^FAIL g\)/);
    expect(r.lines).toContain("  FAIL changed: base/assets/capacitor.config.json");
  });
  it("capacitor.plugins.json changed, a new asset, a removed file, BundleConfig changed → FAIL g each", () => {
    const cases: [Record<string, Buffer | string | null>, string][] = [
      [{ "base/assets/capacitor.plugins.json": '[{"pkg":"x"}]' }, "  FAIL changed: base/assets/capacitor.plugins.json"],
      [{ "base/assets/tracker.js": "x" }, "  FAIL NEW file not from CameraX / ML Kit: base/assets/tracker.js"],
      [{ "base/assets/public/index.html": null }, "  FAIL removed: base/assets/public/index.html"],
      [{ "BundleConfig.pb": "other" }, "  FAIL changed: BundleConfig.pb"],
      [{ "base/root/META-INF/androidx.core_core.version": "1.16.0" }, "  FAIL changed: base/root/META-INF/androidx.core_core.version"],
      [{ "base/root/META-INF/com.example_spy.version": "1" }, "  FAIL NEW file not from CameraX / ML Kit: base/root/META-INF/com.example_spy.version"],
      [{ "base/res/drawable/splash.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]) }, "  FAIL changed: base/res/drawable/splash.png"],
      [{ "base/res/drawable/new_thing.png": "x" }, "  FAIL NEW file not from CameraX / ML Kit: base/res/drawable/new_thing.png"],
    ];
    for (const [over, line] of cases) {
      const r = gate({ newZip: aab(NEW_LIBS, "new", over) });
      expect(r.lines, line).toContain(line);
      expect(r.pass).toBe(false);
    }
  });
  it("a res XML whose content changed → FAIL g; only moved resource numbers → same", () => {
    const r = gate({ newZip: aab(NEW_LIBS, "new", { "base/res/drawable/a_icon.xml": resXml({ shift: 3, width: "48dp" }) }) });
    expect(r.lines).toContain("  FAIL changed: base/res/drawable/a_icon.xml");
    expect(pbCanon("XmlNode", resXml({ shift: 3 }))).toBe(pbCanon("XmlNode", resXml()));
    expect(pbCanon("XmlNode", resXml({ tint: "@color/other" }))).not.toBe(pbCanon("XmlNode", resXml()));
  });
  it("resources.pb: an existing value changed or removed → FAIL g; style entries reordered by new numbers → same", () => {
    const one = (o: Parameters<typeof resTable>[0]) => gate({ newZip: aab(NEW_LIBS, "new", { "base/resources.pb": resTable({ shift: 3, ...o }) }) });
    expect(one({ appName: "SellerFlow" }).lines).toContain("  FAIL resource changed: com.sellerflow.live:string/app_name");
    expect(one({ removeSplash: true }).lines).toContain("  FAIL resource removed: com.sellerflow.live:drawable/splash");
    expect(one({ style: "changed" }).lines).toContain("  FAIL resource changed: com.sellerflow.live:style/AppTheme");
    const a = resourceEntries(resTable()), b = resourceEntries(resTable({ shift: 3 }));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [k, v] of a) expect(b.get(k), k).toBe(v);
  });
  it("a resources.pb (or res XML) it cannot read → CANNOT MEASURE — STOP, never PASS", () => {
    const r = gate({ newZip: aab(NEW_LIBS, "new", { "base/resources.pb": Buffer.from([0x0a, 0xff, 0xff, 0xff]) }) });
    expect(r.status).toBe("cannot");
    expect(firstLine(r, "g)")).toMatch(/^CANNOT MEASURE g\) every other file: resources\.pb cannot be read/);
    const x = gate({ newZip: aab(NEW_LIBS, "new", { "base/res/drawable/a_icon.xml": "<vector/> plain text" }) });
    expect(x.status).toBe("cannot");
  });
  it("what IS allowed new: the 3 sfl_qr drawables, the ML Kit model, new libraries' version files, new resources", () => {
    const r = gate();
    for (const n of QR_RES) expect(all(r)).toContain(`    new base/res/drawable/${n}.xml (sfl_qr drawable)`);
    expect(all(r)).toContain("    new base/assets/mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite (ML Kit model)");
    expect(all(r)).toContain("    new base/root/META-INF/androidx.camera_camera-core.version (from androidx.camera:camera-core)");
    expect(all(r)).toContain("    new base/root/transport-runtime.properties (from com.google.android.datatransport:transport-runtime)");
    expect(all(r)).toMatch(/resources\.pb: 6 resources of the base — 6 the same by name and value; 4 new \(3 sfl_qr drawables \+ 1 from the new libraries\)/);
    expect(rootFileOf("META-INF/camera-core_release.kotlin_module", ["androidx.camera:camera-core"])).toBe("from androidx.camera:camera-core");
    expect(rootFileOf("META-INF/camera-core.version", ["androidx.camera:camera-core"])).toBeNull();
  });
});


describe("Fix Round 4 rules — each one turns FAIL / CANNOT MEASURE", () => {
  // a) the ONLY files that may differ without being compared
  it("the baseline profile and version-control-info differ in every build: not compared — these exact files only", () => {
    expect([...EXPECTED_DIFF].sort()).toEqual([
      "BUNDLE-METADATA/com.android.tools.build.profiles/baseline.prof",
      "BUNDLE-METADATA/com.android.tools.build.profiles/baseline.profm",
      "META-INF/version-control-info.textproto",
      "base/root/META-INF/version-control-info.textproto",
    ]);
    for (const f of EXPECTED_DIFF) {
      const r = gate({ mainZip: aab(LIBS_MAIN, "main", { [f]: "made by the base build" }), newZip: aab(NEW_LIBS, "new", { [f]: "made by the new build" }) });
      expect(r.pass, `${f}\n${all(r)}`).toBe(true);
      expect(r.lines, f).toContain(`    not compared (differs in every build): ${f}`);
      // only in the new build (the base had none) = the same: not compared
      expect(gate({ newZip: aab(NEW_LIBS, "new", { [f]: "x" }) }).pass, f).toBe(true);
    }
  });
  it("…and nothing next to them: another file in the same folders that changed or is new → FAIL g, named", () => {
    const changed = ["BUNDLE-METADATA/com.android.tools.build.profiles/other.prof", "BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map", "base/root/META-INF/services/x.Provider", "base/assets/dexopt/baseline.prof"];
    for (const f of changed) {
      const r = gate({ mainZip: aab(LIBS_MAIN, "main", { [f]: "base" }), newZip: aab(NEW_LIBS, "new", { [f]: "new" }) });
      expect(r.lines, f).toContain(`  FAIL changed: ${f}`);
      expect(r.status).toBe("fail");
    }
    const r = gate({ newZip: aab(NEW_LIBS, "new", { "META-INF/version-control-info.textproto.bak": "x" }) });
    expect(r.lines).toContain("  FAIL NEW file not from CameraX / ML Kit: META-INF/version-control-info.textproto.bak");
  });
  // b) size: a table that says nothing is not a PASS
  it("a size table with no rows, a value that is not a number, or a missing table → CANNOT MEASURE f", () => {
    const ok = "ABI,MIN,MAX\narm64-v8a,20000000,20000000\narmeabi-v7a,18000000,18000000\n";
    const bad: [string, { mainSizeCsv?: string; newSizeCsv?: string }, RegExp][] = [
      ["new table: header only", { newSizeCsv: "ABI,MIN,MAX\n" }, /the size table of the new build has no rows/],
      ["base table: header only", { mainSizeCsv: "ABI,MIN,MAX\n" }, /the size table of the base build has no rows/],
      ["new table: an error text instead of a table", { newSizeCsv: "Error: device spec not found\n" }, /the size table of the new build has no rows/],
      ["a word where a number belongs", { newSizeCsv: "ABI,MIN,MAX\narm64-v8a,1,abc\narmeabi-v7a,1,21000000\n" }, /the size of arm64-v8a in the new table is not a number/],
      ["an empty value", { mainSizeCsv: "ABI,MIN,MAX\narm64-v8a,1,\narmeabi-v7a,1,18000000\n" }, /the size of arm64-v8a in the base table is not a number/],
      ["a negative value", { newSizeCsv: "ABI,MIN,MAX\narm64-v8a,1,-5\narmeabi-v7a,1,21000000\n" }, /is not a number/],
      ["only one of the two tables", { newSizeCsv: "" }, /no size table for the new build/],
      ["a chip type with no row in the base table", { mainSizeCsv: "ABI,MIN,MAX\narm64-v8a,20000000,20000000\n" }, /no row for armeabi-v7a in the base size table/],
    ];
    for (const [name, over, why] of bad) {
      const r = gate({ mainSizeCsv: ok, ...over });
      expect(firstLine(r, "f) size"), name).toMatch(/^CANNOT MEASURE f\) size: /);
      expect(firstLine(r, "f) size"), name).toMatch(why);
      expect(r.status, name).toBe("cannot");
      expect(r.pass, name).toBe(false);
    }
    // without bundletool: the two .aab sizes must be real numbers too
    for (const over of [{ newAabBytes: NaN }, { mainAabBytes: 0 }, { newAabBytes: undefined as unknown as number }]) {
      const r = gate({ mainSizeCsv: "", newSizeCsv: "", ...over });
      expect(firstLine(r, "f) size")).toMatch(/^CANNOT MEASURE f\) size: the \.aab sizes are not numbers/);
      expect(r.status).toBe("cannot");
    }
    expect(checkSize({ mainCsv: ok, newCsv: ok, mainAab: 1, newAab: 1, maxMb: NaN }).cannot).toBe(true);
  });
  // c) under base/lib/ only <chip>/<name>.so belongs to checks a / b
  it("a file under base/lib/ that is not a chip's .so (wrap.sh …) is compared like every other file; new → FAIL g", () => {
    const added = gate({ newZip: aab(NEW_LIBS, "new", { "base/lib/arm64-v8a/wrap.sh": "#!/system/bin/sh\nexec \"$@\"\n" }) });
    expect(added.lines).toContain("  FAIL NEW file not from CameraX / ML Kit: base/lib/arm64-v8a/wrap.sh");
    expect(added.status).toBe("fail");
    for (const f of ["base/lib/arm64-v8a/wrap.sh", "base/lib/arm64-v8a/gdbserver", "base/lib/notes.txt", "base/lib/arm64-v8a/deep/libx.so"]) {
      const r = gate({ mainZip: aab(LIBS_MAIN, "main", { [f]: "base" }), newZip: aab(NEW_LIBS, "new", { [f]: "new" }) });
      expect(r.lines, f).toContain(`  FAIL changed: ${f}`);
      const gone = gate({ mainZip: aab(LIBS_MAIN, "main", { [f]: "base" }) });
      expect(gone.lines, f).toContain(`  FAIL removed: ${f}`);
      // the same bytes in both = fine
      expect(gate({ mainZip: aab(LIBS_MAIN, "main", { [f]: "same" }), newZip: aab(NEW_LIBS, "new", { [f]: "same" }) }).pass, f).toBe(true);
    }
  });
  // d) the merge report is the only proof of where a new manifest part comes from
  it("no merge report → CANNOT MEASURE e (a CameraX-looking name allows nothing)", () => {
    for (const newBlame of ["", "   \n", undefined as unknown as string, "this is not a merge report\n"]) {
      const r = gate({ newBlame });
      expect(firstLine(r, "e)")).toMatch(/^CANNOT MEASURE e\) manifest: no merge report/);
      expect(r.status).toBe("cannot");
      expect(r.pass).toBe(false);
      expect(all(r)).not.toMatch(/RESULT: PASS/);
    }
    expect(checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, "").cannot).toBe(true);
    expect(checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, BLAME).ok).toBe(true);
  });
  it("a new part with no line in the merge report → CANNOT MEASURE e, also when its name starts with androidx.camera", () => {
    for (const name of ["androidx.camera.fake.Spy", "com.google.mlkit.fake.Spy", "com.example.Tracker"]) {
      const r = gate({ newManifest: MANIFEST_SCANNER.replace("    </application>", `        <service android:name="${name}" />\n    </application>`) });
      expect(firstLine(r, "e)"), name).toMatch(/^CANNOT MEASURE e\) manifest: NEW service .* has no line in the merge report/);
      expect(r.status, name).toBe("cannot");
    }
  });
  it("a real change is still a FAIL with the report missing in the list of reasons (LAUNCHER removed + no report)", () => {
    const r = gate({ newBlame: "", newManifest: MANIFEST_SCANNER.replace('                <category android:name="android.intent.category.LAUNCHER" />\n', "") });
    expect(r.status).toBe("cannot");
    expect(all(r)).toMatch(/FAIL removed or changed in <application>: <activity com\.sellerflow\.live\.MainActivity>/);
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
  it("gradle dependencies: resolved versions; constraints and projects skipped; odd lines kept aside", () => {
    const m = parseGradleDeps(DEPS_MAIN);
    expect(Object.fromEntries(m.deps)).toEqual({ "androidx.appcompat:appcompat": "1.7.0", "androidx.activity:activity": "1.9.2", "androidx.core:core": "1.15.0", "androidx.browser:browser": "1.8.0" });
    expect(m.unreadable).toEqual([]);
    const d = checkDeps(m, parseGradleDeps(DEPS_SCANNER));
    expect(d.ok).toBe(true);
    expect(d.added).toEqual(["androidx.camera:camera-core", "com.google.android.datatransport:transport-runtime", "com.google.mlkit:barcode-scanning"]);
    expect(checkDeps({ deps: new Map(), unreadable: [] }, { deps: new Map(), unreadable: [] }).cannot).toBe(true); // an empty list never passes
    expect(parseGradleDeps("+--- a:b:{prefer 1.0} -> 1.0\n").unreadable).toHaveLength(1);
  });
  it("manifest: whole-element compare + merge report", () => {
    const doc = parseXml(MANIFEST_SCANNER);
    const app = doc.children[0].children.find((c: { tag: string }) => c.tag === "application");
    expect(app.children.map((c: { tag: string }) => c.tag)).toEqual(["activity", "provider", "service", "service", "provider"]);
    // attribute order and child order do not matter; content does
    expect(canonXml(parseXml('<a y="2" x="1"><b/><c/></a>').children[0])).toBe(canonXml(parseXml('<a x="1" y="2"><c/><b/></a>').children[0]));
    expect(canonXml(parseXml('<a x="1"><b z="1"/></a>').children[0])).not.toBe(canonXml(parseXml('<a x="1"><b z="2"/></a>').children[0]));
    expect(() => parseXml("<a><b></a>")).toThrow();
    const b = parseBlame(BLAME);
    expect(b.get("service androidx.camera.core.impl.MetadataHolderService")).toBe("androidx.camera:camera-core");
    expect(b.get("provider com.google.mlkit.common.internal.MlKitInitProvider")).toBe("com.google.mlkit:common");
    expect(b.get("android.permission.INTERNET")).toBe("app");
    const r = checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, BLAME);
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(r.lines.join("\n")).toMatch(/service androidx\.camera\.core\.impl\.MetadataHolderService \(from androidx\.camera:camera-core\)/);
    // the merge report says a "camera-looking" service came from somewhere else → not allowed
    const lie = BLAME.replace("[androidx.camera:camera-core:1.5.2] /Users/j/.gradle/caches/x/AndroidManifest.xml:24:9-33:19", "[com.example:spy:1.0] /x:1:1");
    expect(checkManifest(MANIFEST_MAIN, MANIFEST_SCANNER, lie).ok).toBe(false);
  });
  it("protobuf reader: fields, odd input throws", () => {
    expect(pbFields(pb([[1, 5], [2, "hi"]])).map((f: { no: number }) => f.no)).toEqual([1, 2]);
    expect(() => pbFields(Buffer.from([0x0a, 0x05, 0x01]))).toThrow();
    expect(() => pbFields(Buffer.from([0x0b]))).toThrow(); // wire type 3
    expect(checkBundleEntries(aab(LIBS_MAIN), aab(LIBS_MAIN)).ok).toBe(true);
  });
});

// ── the real checker as a program, on made-up files + a fake dexdump ────────────────────────
describe("the checker program", () => {
  const dir = mkdtempSync(join(tmpdir(), "sfl-gate-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fakeDexdump = join(dir, "dexdump");
  // fake dexdump: the test "dex" files hold dexdump text already; it insists on "-d -a" (annotations)
  writeFileSync(fakeDexdump, '#!/bin/sh\n[ "$1" = "-d" ] && [ "$2" = "-a" ] || { echo "called without -d -a" >&2; exit 9; }\ncat "$3"\n');
  chmodSync(fakeDexdump, 0o755);
  const jar = makeZip({ "com/gengcon/print/draw/PrintBuilder.class": "x" });
  function setup(name: string, o: { newText?: string; lfs?: boolean; newLibs?: Record<string, Buffer>; newDeps?: string; newOver?: Record<string, Buffer | string | null>; noBlame?: boolean } = {}) {
    const d = join(dir, name);
    for (const s of ["main", "new"]) {
      mkdirSync(join(d, s, "libs"), { recursive: true });
      writeFileSync(join(d, s, "libs/4.1.1-release.aar"), o.lfs && s === "new" ? "version https://git-lfs.github.com/spec/v1\n" : makeZip({ "classes.jar": jar }));
      writeFileSync(join(d, s, "libs/image-1.9.5.aar"), makeZip({ "classes.jar": makeZip({ "a/B.class": "y" }) }));
      writeFileSync(join(d, s, "libs/LPAPI-2019-11-20-R.jar"), makeZip({ "c/D.class": "z" }));
    }
    writeFileSync(join(d, "main.aab"), aabFiles(LIBS_MAIN, "main", {}, dexdumpText({ layout: 0, scanner: false })));
    writeFileSync(join(d, "new.aab"), aabFiles(o.newLibs ?? NEW_LIBS, "new", o.newOver ?? {}, o.newText ?? dexdumpText({ layout: 1, scanner: true })));
    writeFileSync(join(d, "main.deps"), DEPS_MAIN); writeFileSync(join(d, "new.deps"), o.newDeps ?? DEPS_SCANNER);
    writeFileSync(join(d, "main.xml"), MANIFEST_MAIN); writeFileSync(join(d, "new.xml"), MANIFEST_SCANNER); writeFileSync(join(d, "blame.txt"), BLAME);
    return spawnSync("node", [CHECKER, "--main-aab", join(d, "main.aab"), "--new-aab", join(d, "new.aab"), "--main-deps", join(d, "main.deps"), "--new-deps", join(d, "new.deps"),
      "--main-manifest", join(d, "main.xml"), "--new-manifest", join(d, "new.xml"), ...(o.noBlame ? [] : ["--new-blame", join(d, "blame.txt")]),
      "--main-libs", join(d, "main/libs"), "--new-libs", join(d, "new/libs"), "--dexdump", fakeDexdump, "--max-mb", "6"], { encoding: "utf8" });
  }
  it("only the scanner → exit 0, RESULT: PASS", () => {
    const r = setup("ok");
    if (process.env.SHOW_GATE) writeFileSync(process.env.SHOW_GATE, r.stdout); // SHOW_GATE=<file> = keep the report
    expect(r.stdout).toMatch(/RESULT: PASS/);
    expect(r.status).toBe(0);
  });
  it("a printer class changed → exit 1, STOP", () => {
    const r = setup("tspl", { newText: dexdumpText({ layout: 1, scanner: true, tspl: "7" }) });
    expect(r.stdout).toMatch(/STOP — do not release/);
    expect(r.status).toBe(1);
  });
  it("an annotation changed → exit 1", () => {
    expect(setup("anno", { newText: dexdumpText({ layout: 1, scanner: true, returnType: "callback" }) }).status).toBe(1);
  });
  it("a changed .so → exit 1; a changed asset → exit 1", () => {
    expect(setup("so", { newLibs: { ...LIBS_MAIN, "armeabi-v7a/libskia.so": makeElf(false, 4096, 8), ...LIBS_SCANNER } }).status).toBe(1);
    expect(setup("asset", { newOver: { "base/assets/capacitor.plugins.json": "[1]" } }).status).toBe(1);
  });
  it("an unreadable dependency line → exit 2, CANNOT MEASURE — STOP", () => {
    const r = setup("deps", { newDeps: DEPS_SCANNER + "+--- a.b:c:{require 1.0} -> 1.2\n" });
    expect(r.stdout).toMatch(/CANNOT MEASURE — STOP/);
    expect(r.status).toBe(2);
  });
  it("no merge report passed → exit 2, CANNOT MEASURE — STOP (Fix Round 4)", () => {
    const r = setup("noblame", { noBlame: true });
    expect(r.stdout).toMatch(/CANNOT MEASURE e\) manifest: no merge report/);
    expect(r.stdout).not.toMatch(/RESULT: PASS/);
    expect(r.status).toBe(2);
  });
  it("a printer library still a Git LFS pointer → exit 2, CANNOT MEASURE — STOP (never a PASS)", () => {
    const r = setup("lfs", { lfs: true });
    expect(r.stdout).toMatch(/CANNOT MEASURE — STOP: 4\.1\.1-release\.aar is a Git LFS pointer in the new build/);
    expect(r.status).toBe(2);
  });
});

describe("the shell script (it runs only on the Mac — its rules are pinned here)", () => {
  const sh = readFileSync(SCRIPT, "utf8");
  const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("builds the base and this commit in two NEW worktrees, never in this checkout or ~/Sellerflow; no worktree prune", () => {
    expect(code).toContain('git -C "$ROOT" worktree add -q --detach "$WORK/main" "$BASE_SHA"');
    expect(code).toContain('git -C "$ROOT" worktree add -q --detach "$WORK/new" "$NEW_SHA"');
    expect(code).not.toMatch(/\bgit (-C "[^"]*" )?(checkout|switch|reset|stash|clean|restore)\b/);
    expect(code).not.toMatch(/worktree prune/);
    expect(code).not.toMatch(/cd "\$ROOT\/mobile/);
    expect(code).not.toMatch(/\$HOME\/Sellerflow\/[^"\n]*(gradlew|npm|cap sync)/);
    // ~/Sellerflow is only READ for the key file / SDK path
    expect((code.match(/\$HOME\/Sellerflow/g) || []).length).toBe(2);
    expect(code).toContain('worktree remove --force "$wt"');
    // the header says honestly what it writes in the shared .git and that the key is only read
    expect(sh).toMatch(/What it WRITES, honestly:/);
    for (const w of ["git fetch origin main", "git worktree add", "git lfs pull", "only READ"]) expect(sh).toContain(w);
  });
  it("release build, the release classpath, the source byte pin, every check input passed to the checker", () => {
    expect(code).toContain("clean bundleRelease");
    expect(code).toContain(":app:dependencies --configuration releaseRuntimeClasspath");
    expect(code).toContain('SCANNER_GATE=1 node scripts/native-scanner-fence.mjs --check --base "$BASE_SHA"');
    for (const a of ["--main-aab", "--new-aab", "--main-deps", "--new-deps", "--main-manifest", "--new-manifest", "--main-libs", "--new-libs", "--dexdump", "--max-mb"]) expect(code).toContain(a);
    expect(code).toContain('die "keystore.properties not found');
    expect(code).toContain('die "dexdump not found');
    expect(code).toContain('die() { say "CANNOT MEASURE — STOP: $*"');
  });
  it("safe on the Mac's bash 3.2 (empty arrays) and stops on the checker's exit code", () => {
    expect(code).toContain('${SIZE_ARGS[@]+"${SIZE_ARGS[@]}"}');
    expect(code).toContain('${BLAME_ARGS[@]+"${BLAME_ARGS[@]}"}');
    expect(code).toContain("code=${PIPESTATUS[0]}");
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  // the commit choice, run for real on a made-up git history (--commits = print the two commits, build nothing)
  const repo = mkdtempSync(join(tmpdir(), "sfl-gate-git-"));
  const home = mkdtempSync(join(tmpdir(), "sfl-gate-home-"));
  afterAll(() => { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  const SC = "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java";
  const put = (rel: string, txt: string) => { mkdirSync(join(repo, rel, ".."), { recursive: true }); writeFileSync(join(repo, rel), txt); };
  const commit = (msg: string) => { git("add", "-A"); git("commit", "-q", "-m", msg, "--allow-empty"); return git("rev-parse", "HEAD"); };
  const run = () => spawnSync("bash", [join(repo, "mobile/android/qr-scanner-gate.sh"), "--commits"], { encoding: "utf8", env: { ...process.env, HOME: home, TMPDIR: home } });
  let c1 = "", c2 = "", c4 = "";
  it("base = the newest main commit WITHOUT the scanner (walking main's own line), new = HEAD; both printed", () => {
    git("init", "-q", "-b", "main");
    mkdirSync(join(repo, "mobile/android"), { recursive: true });
    copyFileSync(SCRIPT, join(repo, "mobile/android/qr-scanner-gate.sh"));
    put("a.txt", "1"); c1 = commit("c1");
    put("a.txt", "2"); c2 = commit("c2");
    git("checkout", "-q", "-b", "scanner");
    put(SC, "class X {}"); const s1 = commit("scanner");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "merge scanner", s1);
    put("a.txt", "3"); c4 = commit("c4 after the merge");
    git("update-ref", "refs/remotes/origin/main", c4);
    const r = run();
    expect(r.stdout, r.stdout + r.stderr).toContain(`base = ${c2}`);
    expect(r.stdout).toContain(`new  = ${c4}`);
    expect(r.status).toBe(0);
  });
  it("before the merge: base = origin/main itself; new = the scanner branch", () => {
    git("update-ref", "refs/remotes/origin/main", c2);
    git("checkout", "-q", "scanner");
    const r = run();
    expect(r.stdout).toContain(`base = ${c2}`);
    expect(r.stdout).toContain(`new  = ${git("rev-parse", "HEAD")}`);
    expect(r.status).toBe(0);
  });
  it("HEAD without the scanner → CANNOT MEASURE — STOP (exit 2)", () => {
    git("checkout", "-q", "--detach", c1);
    const r = run();
    expect(r.stdout).toMatch(/CANNOT MEASURE — STOP: this commit \([0-9a-f]{8}\) has no .*SellerFlowScannerPlugin\.java/);
    expect(r.status).toBe(2);
  });
  it("every main commit has the scanner → CANNOT MEASURE — STOP (exit 2)", () => {
    git("checkout", "-q", "scanner");
    const lone = git("commit-tree", git("rev-parse", "HEAD^{tree}"), "-m", "root with scanner");
    git("update-ref", "refs/remotes/origin/main", lone);
    const r = run();
    expect(r.stdout).toMatch(/CANNOT MEASURE — STOP: no commit of origin\/main without the scanner was found/);
    expect(r.status).toBe(2);
    void c4;
  });
});
