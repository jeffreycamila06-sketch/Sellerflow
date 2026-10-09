// Build 10 — "blank to outsiders". Pins: the logger prints nothing outside dev; no raw console.*
// in the app except the one start banner; the build ships no source maps and no dev log text
// and no app.html (scripts/check-dist.mjs, run in CI after the build); the Terms page + the
// Legal-screen link in all 8 languages; the marker label is unused and unique.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeLogger } from "../log";
import { LOG_PURE_NAMES } from "../logPure";
import Legal from "../../redesign/screens/Legal";
import { TProvider, buildT } from "../../redesign/i18n";
import { checkDist, devLogMessages, markerValue, MARKER_KEY, BANNER_START } from "../../../scripts/check-dist.mjs";
import { CONSOLE_BANNER } from "../../redesign/main";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const appFiles = () => walk(SRC).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !f.includes("__tests__"));

describe("logger", () => {
  const sink = () => ({ log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  it("outside dev it prints nothing at all", () => {
    const s = sink();
    const l = makeLogger(false, s);
    l.log("a"); l.info("b"); l.warn("c", { x: 1 }); l.error(new Error("d")); l.debug("e");
    for (const fn of Object.values(s)) expect(fn).not.toHaveBeenCalled();
  });
  it("in dev it passes everything through", () => {
    const s = sink();
    const l = makeLogger(true, s);
    l.warn("w", 1); l.error("e");
    expect(s.warn).toHaveBeenCalledWith("w", 1);
    expect(s.error).toHaveBeenCalledWith("e");
  });
});

describe("no raw console in the app", () => {
  it("only the start banner calls console directly", () => {
    const hits: string[] = [];
    for (const f of appFiles()) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/\bconsole\.[a-z]+\s*\(/.test(line)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual(["src/redesign/main.tsx:14: console.log(CONSOLE_BANNER);"]);
  });
  it("the banner is the two agreed lines", () => {
    expect(CONSOLE_BANNER).toBe("Walang makukuha dito. Mag-live ka na lang, kaibigan. 😘\nNothing for you here. Go sell something, friend.");
    expect(CONSOLE_BANNER.startsWith(BANNER_START)).toBe(true);
  });
  it("every logger import is `log` or `log as devLog` — the names the build strips", () => {
    for (const f of appFiles()) {
      for (const m of readFileSync(f, "utf8").matchAll(/import \{([^}]*)\} from "[./]+\/lib\/log"/g)) {
        expect(["log", "log as devLog"], f).toContain(m[1].trim());
      }
    }
    for (const n of ["log", "devLog"]) for (const k of ["log", "info", "warn", "error", "debug"]) expect(LOG_PURE_NAMES).toContain(`${n}.${k}`);
  });
});

describe("build config", () => {
  const cfg = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
  it("source maps are off, logger calls are stripped, the old app page is not built", () => {
    expect(cfg).toMatch(/sourcemap:\s*false/);
    expect(cfg).toMatch(/manualPureFunctions:\s*LOG_PURE_NAMES/);
    expect(cfg).not.toMatch(/^\s*app:\s*['"]app\.html['"]/m);
  });
  it("CI runs the dist check right after the build", () => {
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toMatch(/- run: npm run build\n\s+- run: npm run check:dist/);
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["check:dist"]).toBe("node scripts/check-dist.mjs");
  });
});

describe("scripts/check-dist.mjs", () => {
  const marker = markerValue(SRC);
  function fakeDist(files: Record<string, string>) {
    const d = mkdtempSync(join(tmpdir(), "dist-"));
    for (const [p, body] of Object.entries(files)) { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), body); }
    return d;
  }
  const good = () => ({ "index.html": "<html></html>", "assets/main.js": `x("${marker}");console.log("${BANNER_START} …")`, "assets/main.css": "a{}" });
  it("a clean build passes (the support contact and made-up placeholders are allowed)", () => {
    expect(checkDist(fakeDist({ ...good(), "assets/x.js": `m("jeffreycamila06@gmail.com","you@email.com","a@example.com")` }), SRC)).toEqual([]);
  });
  it("fails on a source map, a sourceMappingURL, app.html, a dev log line, a missing marker or banner", () => {
    const msg = devLogMessages(SRC)[0];
    expect(msg).toBeTruthy();
    const cases: [Record<string, string>, RegExp][] = [
      [{ ...good(), "assets/main.js.map": "{}" }, /source map shipped/],
      [{ ...good(), "assets/main.css": "a{}/*# sourceMappingURL=main.css.map */" }, /sourceMappingURL/],
      [{ ...good(), "app.html": "<html></html>" }, /app\.html/],
      [{ ...good(), "assets/extra.js": `w("${msg}")` }, /dev log message/],
      [{ ...good(), "assets/main.js": `console.log("${BANNER_START}")` }, /marker label missing/],
      [{ ...good(), "assets/main.js": `x("${marker}")` }, /start banner missing/],
      [{ ...good(), "assets/extra.js": `e("seller.one@gmail.com")` }, /email address in the build/],
      [{ ...good(), "assets/extra.js": `t("Sign-in is unavailable (Supabase not configured).")` }, /seller-visible phrase/],
    ];
    for (const [files, rx] of cases) expect(checkDist(fakeDist(files), SRC).join("\n")).toMatch(rx);
  });
});

describe("Terms of Service", () => {
  const html = readFileSync(join(ROOT, "public", "terms", "index.html"), "utf8");
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("covers the agreed points, plain and about 300 words", () => {
    for (const rx of [/reverse engineer/i, /scrap/i, /automated/i, /resell/i, /competing/i, /your data/i, /suspend/i, /jeffreycamila06@gmail\.com/]) expect(text).toMatch(rx);
    const words = text.split(" ").filter(Boolean).length;
    expect(words).toBeGreaterThan(250);
    expect(words).toBeLessThan(450);
  });
  it("says nothing about how the app works", () => {
    for (const w of [/\btoken\b/i, /\bAPI\b/, /\bserver\b/i, /\bSupabase\b/i, /\bwebsocket\b/i, /\bpoll/i]) expect(text).not.toMatch(w);
  });
  it.each(LANGS)("the Legal screen links to it in %s", (lang) => {
    render(<TProvider lang={lang}><Legal /></TProvider>);
    const a = screen.getByTestId("lg-terms-link");
    expect(a.getAttribute("href")).toBe("/terms/");
    expect(a.textContent).toContain(buildT(lang).lg_terms_link);
    expect(buildT(lang).lg_terms_link).not.toBe(lang === "en" ? "" : buildT("en").lg_terms_link);
  });
});

describe("marker label", () => {
  it("exists in all 8 languages with one shared token, and nothing uses the key", () => {
    const token = markerValue(SRC).split(": ")[1];
    expect(token).toMatch(/^stable-[a-z0-9]{7}$/);
    for (const lang of LANGS) expect((buildT(lang) as unknown as Record<string, string>)[MARKER_KEY]).toContain(token);
    const users = appFiles().filter((f) => !f.endsWith(join("i18n", "index.tsx")) && readFileSync(f, "utf8").includes(MARKER_KEY));
    expect(users).toEqual([]);
    const elsewhere = appFiles().filter((f) => !f.endsWith(join("i18n", "index.tsx")) && readFileSync(f, "utf8").includes(token));
    expect(elsewhere).toEqual([]);
  });
});
