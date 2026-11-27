// Waybill username — fence (2026-11-27). The feature makes a PDF in the browser; it never talks to a printer:
//   • no printing / sticker / receipt / printer / Bluetooth file changes (scripts/printing-paths.mjs + by name);
//   • nothing under mobile/ (no app build), server/ + server.js (no Render deploy), chrome-extension/.
// The byte check compares git's content ids with the ids taken from main when the branch was cut
// (fixtures/waybillFence.json, scripts/waybill-fence.mjs). It runs on claude/waybill-username (also in CI) or
// with WAYBILL_GATE=1; on any other branch it is skipped. The other checks here always run.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkHead, fenced, fenceProblems, FIXTURE } from "../../../scripts/waybill-fence.mjs";
import { isPrintingFile } from "../../../scripts/printing-paths.mjs";
import fixture from "./fixtures/waybillFence.json";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const BRANCH = "claude/waybill-username";
const branchNow = (): string => process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
const gateOn = process.env.WAYBILL_GATE === "1" || branchNow() === BRANCH;

const FEATURE = [
  "src/redesign/adapters/waybillCsv.ts", "src/redesign/adapters/waybillMatch.ts", "src/redesign/adapters/waybillRows.ts",
  "src/redesign/adapters/waybillGate.ts", "src/redesign/adapters/waybillPdf.ts", "src/redesign/adapters/waybillPdfRead.ts",
  "src/redesign/screens/WaybillUsername.tsx", "src/redesign/screens/ShippingHub.tsx",
];

describe("Waybill username — byte fence (printing, Bluetooth, mobile/, server, the checker extension)", () => {
  (gateOn ? it : it.skip)("the commit is byte-identical to main for every fenced file; nothing added, removed or uncommitted", () => {
    const r = checkHead(root);
    expect(r.problems).toEqual([]);
    expect(r.base).toBe(fixture.base);
    expect(r.files).toBeGreaterThan(500);
  });
  it("the fence really holds the files it is about", () => {
    const files = Object.keys(fixture.files);
    expect(files.filter((p) => p.startsWith("mobile/")).length).toBeGreaterThan(200);
    for (const p of [
      "src/redesign/adapters/printing.ts", "src/redesign/adapters/printerBridge.ts", "src/redesign/adapters/stickerRaster.ts",
      "src/redesign/adapters/oneSticker.ts", "src/redesign/adapters/escposRaster.ts", "src/redesign/adapters/receiptImage.ts",
      "src/redesign/screens/PrinterSettings.tsx", "src/redesign/screens/Print.tsx", "src/lib/printerRouting.ts",
      "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowPrinterPlugin.java", "mobile/ios/App/App/SellerFlowPrinterPlugin.swift",
      "server.js", "server/fbReceipt.js", "chrome-extension/background.js",
    ]) expect(files, p).toContain(p);
    const tracked = git("ls-tree", "-r", "--name-only", fixture.base).stdout.split("\n").filter(Boolean);
    if (tracked.length) for (const p of tracked.filter((x) => isPrintingFile(x))) expect(files, p).toContain(p);
  });
  it("the files this feature changes are outside the fence", () => {
    for (const p of [...FEATURE, "src/redesign/RedesignApp.tsx", "src/redesign/screens/SettingsHub.tsx", "src/redesign/i18n/index.tsx",
      "src/redesign/redesign.css", "src/dev/fakeSupabase.ts", "package.json", "package-lock.json", "docs/printing/PRINTING_MAP.md",
      "sql/231_waybill_username.sql", "scripts/waybill-fence.mjs", FIXTURE]) expect(fenced(p), p).toBe(false);
  });
  it("the check has teeth: a changed, an added and a removed file are each reported", () => {
    const base = { "mobile/a.java": "100644:aaa", "src/redesign/adapters/printing.ts": "100644:bbb", "server.js": "100644:ccc" };
    expect(fenceProblems(base, { ...base })).toEqual([]);
    expect(fenceProblems(base, { ...base, "src/redesign/adapters/printing.ts": "100644:zzz" })).toEqual(["changed: src/redesign/adapters/printing.ts"]);
    expect(fenceProblems(base, { ...base, "mobile/new.java": "100644:nnn" })).toEqual(["added: mobile/new.java"]);
    const { "server.js": _gone, ...rest } = base;
    expect(fenceProblems(base, rest)).toEqual(["removed: server.js"]);
  });
});

describe("Waybill username never reaches printing, and printing never reaches it", () => {
  const importsOf = (p: string) => [...read(p).matchAll(/^import (?:type )?[^;]*? from "([^"]+)";/gm)].map((m) => m[1]);
  const toPath = (from: string, spec: string) => {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) { if (part === "..") dir.pop(); else if (part !== ".") dir.push(part); }
    return dir.join("/");
  };
  it("no waybill file imports a printing file (or anything named like printing / Bluetooth)", () => {
    for (const f of FEATURE) {
      for (const spec of importsOf(f).filter((x) => x.startsWith("."))) {
        const p = toPath(f, spec);
        for (const ext of [".ts", ".tsx"]) expect(isPrintingFile(p + ext), `${f} → ${p}`).toBe(false);
        expect(/(print|sticker|receipt|bluetooth|niimbot|tspl|escpos)/i.test(p), `${f} → ${p}`).toBe(false);
      }
    }
  });
  it("no printing / Bluetooth word in the waybill code", () => {
    for (const f of FEATURE) {
      const code = read(f).replace(/\/\/.*$/gm, "");
      for (const bad of ["SellerFlowPrinter", "printSlip", "printSticker", "printRawTspl", "savedPrinter", "stickerRaster", "oneSticker", "Bluetooth", "tspl", "escpos"]) {
        expect(code.includes(bad), `${f}: ${bad}`).toBe(false);
      }
    }
  });
  it("pdf-lib is used by ONE file (waybillPdf.ts), and that file is loaded ONLY on the Waybill username screen (dynamic import)", () => {
    const users = git("grep", "--untracked", "-l", "-E", "from \"pdf-lib\"", "--", "src", ":!src/**/__tests__/**").stdout.split("\n").filter(Boolean);
    expect(users).toEqual(["src/redesign/adapters/waybillPdf.ts"]);
    const statics = git("grep", "--untracked", "-l", "-E", "^import [^t][^;]*from \"[./]+(adapters/)?waybillPdf\"", "--", "src", ":!src/**/__tests__/**").stdout.split("\n").filter(Boolean);
    expect(statics).toEqual([]);
    expect(read("src/redesign/screens/WaybillUsername.tsx")).toContain('import("../adapters/waybillPdf")');
  });
  it("no fenced source file knows Waybill username", () => {
    const text = /\.(ts|tsx|js|mjs|java|swift|json|md|html|css)$/;
    const tracked = git("ls-files", "-z").stdout.split("\0").filter((p) => p && fenced(p) && text.test(p));
    expect(tracked.length).toBeGreaterThan(300);
    const hits: string[] = [];
    for (const p of tracked) {
      let s: string;
      try { s = read(p); } catch { continue; }
      if (s.length > 3_000_000) continue;
      if (/waybillUsername|waybill_username|WaybillUsername|waybillPdf/.test(s)) hits.push(p);
    }
    expect(hits).toEqual([]);
  });
});

describe("sql/231 — the switch is created off; the keys are the keys the app reads", () => {
  it("the switch row is 'false' and kept as it is when it already exists", () => {
    expect(read("sql/231_waybill_username.sql")).toContain("insert into public.app_settings (key, value) values ('waybill_username_enabled', 'false')\non conflict (key) do nothing;");
  });
  it("the app reads the same switch and the same preview key", () => {
    expect(read("src/redesign/adapters/featureSwitches.ts")).toContain('waybillUsername: "waybill_username_enabled"');
    expect(read("src/redesign/adapters/featureAccess.ts")).toContain('"waybill_username",');
    expect(read("sql/231_waybill_username.sql")).toContain("('invoicing'), ('waybill_username')");
  });
  it("pdf-lib is pinned to an exact version (no ^ / ~)", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["pdf-lib"]).toBe("1.17.1");
  });
});
