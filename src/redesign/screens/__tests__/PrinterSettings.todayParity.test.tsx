// Accounts that don't see the new Live print pattern (Jeff 2026-11-10): Printer settings is EXACTLY today's —
// the same HTML as main (c35e7a81) for every case: app / browser, Bluetooth / WiFi tab, size list open / closed,
// two sizes, two languages. The fixture was rendered from main's PrinterSettings with the same props.
// (Since the Back button rule, 2026-11-11, only the header Back differs — see below.)
import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { render, cleanup } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";

const noop = () => {};
const today = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__/printerSettings.today.json"), "utf8")) as Record<string, string>;
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

it("same HTML as main for every case (no oneSize / customSize = today's screen)", () => {
  const got: Record<string, string> = {};
  for (const shell of [true, false]) for (const psType of ["bt", "wifi"] as const) for (const open of [true, false]) for (const psSize of ["100x60mm (Standard)", "60x40mm"]) for (const lang of ["en", "zh-TW"] as const) {
    if (shell) (window as unknown as { Capacitor?: unknown }).Capacitor = {}; else delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    const r = render(<TProvider lang={lang}><PrinterSettings onBack={noop} psType={psType} psOut="sticker" onSetPsOut={noop} psSize={psSize} psSizeOpen={open} onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS }} stickerQrAllowed /></TProvider>);
    got[`${shell}|${psType}|${open}|${psSize}|${lang}`] = r.container.innerHTML;
    cleanup();
  }
  expect(Object.keys(got)).toEqual(Object.keys(today));
  // Back button rule (Jeff 2026-11-11): the header's "‹ Back" is now the shared 44 px BackButton — the ONE
  // intended difference. Swap exactly that one button on both sides; everything else must stay byte-equal.
  const BACK = /<button[^>]*>‹ (?:Back|返回)<\/button>/g;
  const oneBack = (html: string, k: string) => { expect((html.match(BACK) ?? []).length, k).toBe(1); return html.replace(BACK, "<BACK/>"); };
  for (const k of Object.keys(today)) {
    expect(got[k], k).toContain('data-testid="back-btn"');
    expect(got[k], k).toContain("min-height: 44px");
    expect(oneBack(got[k], k), k).toBe(oneBack(today[k], k));
  }
});
