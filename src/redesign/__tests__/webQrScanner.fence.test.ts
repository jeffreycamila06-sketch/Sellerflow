// In-page QR scanner — fence (2026-11-25). The feature is WEBSITE ONLY:
//   • nothing under mobile/ changes (no app build), no file is added or removed there;
//   • no printing / sticker / receipt / printer / Bluetooth file changes;
//   • the native scanner's adapter and the centre rule stay byte for byte as they are;
//   • nothing that is not the website changes (server, the checker extension, the packages).
// The byte check compares git's content ids with the ids taken from main when the branch was cut
// (fixtures/webQrScannerFence.json, scripts/web-qr-scanner-fence.mjs). It runs on the branch
// claude/web-qr-scanner (also in CI) or with WEB_QR_GATE=1; on any other branch it is skipped, so later
// work on printing or the app builds is never blocked by it. The other checks here always run.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkHead, fenced, fenceProblems, FIXTURE } from "../../../scripts/web-qr-scanner-fence.mjs";
import { isPrintingFile } from "../../../scripts/printing-paths.mjs";
import fixture from "./fixtures/webQrScannerFence.json";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;
const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const BRANCH = "claude/web-qr-scanner";
const branchNow = (): string => process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
const gateOn = process.env.WEB_QR_GATE === "1" || branchNow() === BRANCH;

describe("in-page QR scanner — byte fence (mobile/, printing, Bluetooth, the native scanner, server, packages)", () => {
  (gateOn ? it : it.skip)("the commit is byte-identical to main for every fenced file; nothing added, nothing removed, nothing uncommitted", () => {
    const r = checkHead(root);
    expect(r.problems).toEqual([]);
    expect(r.base).toBe(fixture.base);
    expect(r.files).toBeGreaterThan(500);
  });
  it("the fence really holds the files it is about", () => {
    const files = Object.keys(fixture.files);
    expect(files.filter((p) => p.startsWith("mobile/")).length).toBeGreaterThan(200); // the whole app-build folder
    for (const p of [
      "src/redesign/adapters/printing.ts", "src/redesign/adapters/printerModels.ts", "src/redesign/adapters/printerBridge.ts",
      "src/redesign/adapters/savedPrinter.ts", "src/redesign/adapters/stickerJobGuard.ts", "src/redesign/adapters/stickerRaster.ts",
      "src/redesign/adapters/oneSticker.ts", "src/redesign/adapters/oneStickerPrint.ts", "src/redesign/adapters/glyphAtlas.latin.ts",
      "src/redesign/adapters/glyphAtlas.cjk.ts", "src/redesign/adapters/btState.ts", "src/redesign/adapters/btOff.ts",
      "src/redesign/adapters/escposRaster.ts", "src/redesign/adapters/cpclRaster.ts", "src/redesign/adapters/reprint.ts",
      "src/redesign/screens/PrinterSettings.tsx", "src/redesign/screens/PrintPattern.tsx", "src/redesign/screens/Print.tsx",
      "src/redesign/components/OneStickerPattern.tsx", "src/lib/printerRouting.ts", "docs/printing/PRINTING_MAP.md",
      "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowPrinterPlugin.java",
      "mobile/android/app/src/main/java/com/sellerflow/live/GenericBleTransport.java",
      "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java",
      "mobile/android/app/src/main/AndroidManifest.xml", "mobile/android/app/build.gradle", "mobile/capacitor.config.ts",
      "mobile/ios/App/App/SellerFlowPrinterPlugin.swift", "mobile/ios/App/App/SellerFlowScannerPlugin.swift", "mobile/ios/App/App/Info.plist",
      "src/redesign/adapters/nativeQrScanner.ts", "src/lib/qrCentrePick.ts", "public/native-version.json",
      "server.js", "package.json", "package-lock.json",
    ]) expect(files, p).toContain(p);
    // every file of the printing list that exists on main is inside
    const tracked = git("ls-tree", "-r", "--name-only", fixture.base).stdout.split("\n").filter(Boolean);
    if (tracked.length) for (const p of tracked.filter((x) => isPrintingFile(x))) expect(files, p).toContain(p);
  });
  it("the files this feature DOES change are outside the fence (it can never fence itself in)", () => {
    for (const p of [
      "src/redesign/adapters/webQrScanner.ts", "src/redesign/adapters/qrDecode.ts", "src/redesign/adapters/featureSwitches.ts",
      "src/redesign/RedesignApp.tsx", "src/redesign/screens/ParcelScan.tsx", "src/redesign/screens/FmParcelScan.tsx",
      "src/redesign/screens/Blacklist.tsx", "src/redesign/screens/Orders.tsx", "src/dev/fakeSupabase.ts",
      "sql/218_web_qr_scanner_switch.sql", "sql/218_web_qr_scanner_switch_rollback.sql", "scripts/web-qr-scanner-fence.mjs", FIXTURE,
    ]) expect(fenced(p), p).toBe(false);
  });
  it("the check has teeth: a changed, an added and a removed file are each reported", () => {
    const base = { "mobile/a.java": "100644:aaa", "src/redesign/adapters/printing.ts": "100644:bbb", "server.js": "100644:ccc" };
    expect(fenceProblems(base, { ...base })).toEqual([]);
    expect(fenceProblems(base, { ...base, "src/redesign/adapters/printing.ts": "100644:zzz" })).toEqual(["changed: src/redesign/adapters/printing.ts"]);
    expect(fenceProblems(base, { ...base, "mobile/a.java": "100755:aaa" })).toEqual(["changed: mobile/a.java"]); // the file mode counts
    expect(fenceProblems(base, { ...base, "mobile/new.java": "100644:nnn" })).toEqual(["added: mobile/new.java"]);
    const { "server.js": _gone, ...rest } = base;
    expect(fenceProblems(base, rest)).toEqual(["removed: server.js"]);
    for (const p of ["mobile/x/y.png", "server/x.js", "chrome-extension/background.js", "src/redesign/adapters/printing.ts", "src/redesign/adapters/stickerRaster.ts",
      "src/redesign/screens/PrinterSettings.tsx", "src/redesign/adapters/btState.ts", "src/redesign/adapters/glyphAtlas.thai.ts", "src/redesign/adapters/oneStickerNew.ts", "package.json"]) {
      expect(fenced(p), p).toBe(true);
    }
  });
});

describe("in-page QR scanner — it never reaches printing, and printing never reaches it", () => {
  const SCANNER = "src/redesign/adapters/webQrScanner.ts";
  it("the scanner imports only: react, the centre rule, the camera / platform helpers, the native adapter (texts + 'is the plugin there'), the QR reader, analytics", () => {
    const from = [...read(SCANNER).matchAll(/^import [^;]*? from "([^"]+)";/gm)].map((m) => m[1]).sort();
    expect(from).toEqual(["../../lib/qrCentrePick", "../analytics", "./camera", "./nativeQrScanner", "./platform", "./qrDecode", "react"].sort());
    for (const f of from.filter((x) => x.startsWith("."))) {
      const path = (f.startsWith("../../") ? `src/${f.slice(6)}` : f.startsWith("../") ? `src/redesign/${f.slice(3)}` : `src/redesign/adapters/${f.slice(2)}`) + ".ts";
      expect(isPrintingFile(path), path).toBe(false);
    }
    expect(read(SCANNER)).not.toMatch(/import\(/); // nothing loaded on the side
  });
  it("no printing / Bluetooth word in the scanner's code", () => {
    const code = read(SCANNER);
    for (const bad of ["SellerFlowPrinter", "printSlip", "printRawTspl", "printSticker", "savedPrinter", "stickerRaster", "oneSticker", "Bluetooth", "bluetooth", "tspl", "escpos"]) {
      expect(code.includes(bad), bad).toBe(false);
    }
  });
  it("no fenced source file knows the in-page scanner (printing code, app builds, server)", () => {
    const text = /\.(ts|tsx|js|mjs|cjs|java|swift|kt|gradle|xml|plist|json|md|html|css|sh)$/;
    const tracked = git("ls-files", "-z").stdout.split("\0").filter((p) => p && fenced(p) && text.test(p));
    expect(tracked.length).toBeGreaterThan(300);
    const hits: string[] = [];
    for (const p of tracked) {
      let s: string;
      try { s = read(p); } catch { continue; }
      if (s.length > 3_000_000) continue; // generated letter tables
      if (/webQrScanner|web_qr_scanner|WebQrScan|wqs-/.test(s)) hits.push(p);
    }
    expect(hits).toEqual([]);
  });
  it("the native scanner's adapter does not know the in-page scanner (the dependency goes one way)", () => {
    expect(read("src/redesign/adapters/nativeQrScanner.ts")).not.toMatch(/webQrScanner|web_qr_scanner/);
    expect(read("src/lib/qrCentrePick.ts")).not.toMatch(/webQrScanner/);
  });
});

describe("in-page QR scanner — the screens ask for it only when there is NO built-in scanner", () => {
  const NATIVE_LINE = "const native = nativeQrScanner();";
  it.each([
    ["src/redesign/screens/ParcelScan.tsx", "if (!native && webQrScanner()) { onWebScanQr(); return; }", "if (!native) { warmQrReader(); qrRef.current?.click(); return; }"],
    ["src/redesign/screens/FmParcelScan.tsx", "if (!native && webQrScanner()) { onWebScanQr(); return; }", "if (!native) { warmQrReader(); qrRef.current?.click(); return; }"],
    ["src/redesign/screens/Blacklist.tsx", "if (!native && webQrScanner()) { onWebScan(); return; }", "if (!native) { warmQrReader(); fileRef.current?.click(); return; }"],
    ["src/redesign/screens/Orders.tsx", "if (!native && webQrScanner()) { onWebScan(); return; }", "if (!native) return; // only reachable if the switch went off after the button was drawn"],
  ])("%s: one gate line, right after the native check; today's line after it is unchanged", (file, gate, todays) => {
    const s = read(file);
    expect(count(s, "webQrScanner()")).toBe(1);
    expect(count(s, gate)).toBe(1);
    expect(count(s, NATIVE_LINE)).toBe(1);
    const lines = s.split("\n").map((l) => l.trim());
    const i = lines.indexOf(NATIVE_LINE);
    expect(lines[i + 1]).toBe(gate);
    expect(lines[i + 2]).toBe(todays);
    expect(count(s, "useWebQrScan()")).toBe(1);
  });
  it("RedesignApp: the native wiring is untouched; the in-page scanner has its own switch and its own prop", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    expect(count(app, "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)}")).toBe(2); // Orders + Blacklist, as before
    expect(count(app, "liveScan=")).toBe(2);
    expect(count(app, "webScan={webScannerAvailable(webQrOn)}")).toBe(2);
    expect(count(app, "const webQrOn = webQrScannerOnFor(featureSw.webQrScanner, isAdmin);")).toBe(1); // admins first, then everyone with the switch
    expect(count(app, "webScan=")).toBe(2);
    expect(count(app, "useEffect(() => { setNativeQrScannerOn(featureSw.nativeQrScanner); }, [featureSw.nativeQrScanner]);")).toBe(1);
    expect(count(app, "useEffect(() => { setWebQrScannerOn(webQrOn); }, [webQrOn]);")).toBe(1);
    expect(count(app, "setWebQrScannerOn(")).toBe(1);
  });
  it("only these files use the in-page scanner", () => {
    const users = git("grep", "-l", "-E", "from \"[./]+(adapters/)?webQrScanner\"", "--", "src", ":!src/**/__tests__/**").stdout.split("\n").filter(Boolean).sort();
    expect(users).toEqual(["src/redesign/RedesignApp.tsx", "src/redesign/screens/Blacklist.tsx", "src/redesign/screens/FmParcelScan.tsx", "src/redesign/screens/Orders.tsx", "src/redesign/screens/ParcelScan.tsx"]);
  });
});

describe("sql/218 — one switch row, off; the rollback removes only that row", () => {
  const code = (p: string) => read(p).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\s+/g, " ").trim();
  it("the file adds ONE app_settings row: web_qr_scanner_enabled = 'false' (kept as it is if the row is already there)", () => {
    expect(code("sql/218_web_qr_scanner_switch.sql")).toBe("begin; insert into public.app_settings (key, value) values ('web_qr_scanner_enabled', 'false') on conflict (key) do nothing; commit;");
  });
  it("the rollback deletes that row and nothing else", () => {
    expect(code("sql/218_web_qr_scanner_switch_rollback.sql")).toBe("begin; delete from public.app_settings where key = 'web_qr_scanner_enabled'; commit;");
  });
  it("the key in the SQL is the key the app reads", () => {
    expect(read("src/redesign/adapters/featureSwitches.ts")).toContain('webQrScanner: "web_qr_scanner_enabled"');
  });
});
