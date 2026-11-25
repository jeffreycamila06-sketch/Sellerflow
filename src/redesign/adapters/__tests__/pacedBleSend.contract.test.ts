// FLASH LABEL Y41BT on Android — paced send (2026-11-25). CI cannot build or run the Android Bluetooth
// code, so this reads the Java / Swift SOURCES and pins what must stay true:
//   • the paced send is for ONE printer name (Y41BT) — the web's own Y41BT entry is that same prefix;
//   • every line added inside GenericBleTransport's existing code is one of the guarded lines listed here,
//     and outside those lines + the two marked regions the file never mentions the paced send;
//   • the generic send every OTHER printer uses keeps its numbers (509 / 8 ms / 1.5 s) and its code;
//   • the AIMO D520BT, Niimbot, the text builder, the classic (paired) writer and the iPhone app never touch it.
// The rules themselves are tested with a fake phone in PacedBleSendTest.java (./gradlew test).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WHITELIST, knownPrinterLang, knownGapAfterMs } from "../printerModels";
import { isPrintingFile } from "../../../../scripts/printing-paths.mjs";

const DIR = "mobile/android/app/src/main/java/com/sellerflow/live/";
const read = (p: string) => readFileSync(p, "utf8");
const paced = read(`${DIR}PacedBleSend.java`);
const generic = read(`${DIR}GenericBleTransport.java`);
const plugin = read(`${DIR}SellerFlowPrinterPlugin.java`);

const OPEN = "// >>> Y41BT paced send";
const CLOSE = "// <<< Y41BT paced send";
const MARK = /\s*\/\/ Y41BT$/;

// GenericBleTransport without the two marked regions; `marked` = the single lines ending with "// Y41BT"
function split(src: string): { rest: string[]; marked: string[]; regions: number } {
  const rest: string[] = [];
  const marked: string[] = [];
  let inside = false;
  let regions = 0;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t === OPEN) { expect(inside, "a region opened twice").toBe(false); inside = true; regions++; continue; }
    if (t === CLOSE) { expect(inside, "a region closed twice").toBe(true); inside = false; continue; }
    if (inside) continue;
    if (MARK.test(line)) { marked.push(line.replace(MARK, "").trim()); continue; }
    rest.push(line);
  }
  expect(inside, "a region is never closed").toBe(false);
  return { rest, marked, regions };
}

describe("paced send — one printer only", () => {
  it("the name list is exactly the Y41BT, and it is the web's Y41BT entry", () => {
    expect(paced).toMatch(/static final String\[\] NAME_PREFIXES = \{ "Y41BT" \};/);
    const flash = WHITELIST.filter((w) => w.brand === "Flash");
    expect(flash.map((w) => w.prefix)).toEqual(["Y41BT"]);
    expect(knownPrinterLang("Y41BT-0FC4_LE")).toBe("tspl");
    // the Xprinter XP-420B keeps its own rule (the wait after a sticker) and is not a paced printer
    expect(knownGapAfterMs("XP-420B")).toBe(1500);
    expect(knownGapAfterMs("Y41BT-0FC4_LE")).toBe(0);
    for (const w of WHITELIST) if (w.brand !== "Flash") expect("Y41BT".startsWith(w.prefix.toUpperCase()) || w.prefix.toUpperCase().startsWith("Y41BT"), w.prefix).toBe(false);
  });

  it("the numbers: pieces of at most 180 bytes, 8 ms after each answer, 8 to 20 s for the printer's answer", () => {
    expect(paced).toMatch(/static final int MAX_CHUNK = 180;/);
    expect(paced).toMatch(/static final long GAP_MS = 8;/);
    expect(paced).toMatch(/static final long CONFIRM_TIMEOUT_MS = 8000;/);
    expect(paced).toMatch(/static final long CONFIRM_TIMEOUT_MAX_MS = 20000;/);
    // the whole job still ends inside the transport's 30 s limit, which is under the web's 35 s lane watchdog
    expect(generic).toMatch(/private static final long OVERALL_CAP_MS = 30000;/);
    expect(read("src/redesign/adapters/printing.ts")).toMatch(/const NATIVE_PRINT_WATCHDOG_MS = 35000;/);
  });

  it("the rules file is pure Java (no Android import) and is on the printing file list", () => {
    expect(paced).not.toMatch(/^import android\./m);
    expect(paced).not.toMatch(/^import com\.getcapacitor/m);
    expect(isPrintingFile(`${DIR}PacedBleSend.java`)).toBe(true);
  });

  it("the question after the last piece reads only standard values, never the print service", () => {
    const block = paced.slice(paced.indexOf("CONFIRM_READS = {"), paced.indexOf("};", paced.indexOf("CONFIRM_READS = {")));
    const services = Array.from(block.matchAll(/\{"([0-9A-F]{4})", "[0-9A-F]{4}"\}/g), (m) => m[1]);
    expect(services.length).toBeGreaterThan(1);
    for (const s of services) expect(["1800", "180A"]).toContain(s);
  });
});

describe("GenericBleTransport — every other printer runs the code it ran before", () => {
  const { rest, marked, regions } = split(generic);

  it("the lines added inside existing code are exactly these guarded lines", () => {
    expect(regions).toBe(2);
    expect(marked).toEqual([
      "boolean paced;",
      "boolean delivered;",
      "private boolean pacedWanted;",
      "private PacedBleSend.Driver paced;",
      "private BluetoothGattCharacteristic confirmChar;",
      'private String confirmName = "none";',
      "private long sendStartedAt, allTakenAt, confirmedAt;",
      "pacedWanted = PacedBleSend.appliesTo(nameHint, deviceName);",
      'paced = null; confirmChar = null; confirmName = "none"; sendStartedAt = allTakenAt = confirmedAt = 0;',
      "if (paced != null) { paced.onDisconnected(); return; }",
      "if (paced != null) { if (jobActive && g == gatt) paced.onWriteAnswer(status == BluetoothGatt.GATT_SUCCESS); return; }",
      "if (pacedWanted) { beginPaced(chunkSize); return; }",
      "if (paced != null) pacedFillResult(r);",
      "if (paced != null) pacedLogFailure();",
      "if (paced != null) { paced.stop(); paced = null; }",
      "pacedWanted = false; confirmChar = null;",
    ]);
    // every added STATEMENT that can change what happens is behind paced / pacedWanted
    for (const line of marked.filter((l) => /\breturn;|beginPaced|onDisconnected|onWriteAnswer|pacedFillResult|pacedLogFailure|\.stop\(\)/.test(l))) {
      expect(line, line).toMatch(/^if \((paced != null|pacedWanted)\)/);
    }
  });

  it("outside those lines and the two regions the file never mentions the paced send", () => {
    // (an old comment of the generic pump says "is paced by a timer" — the English word, not this feature)
    const body = rest.filter((l) => !l.trim().startsWith("void printJob(")).join("\n").replace("is paced by a timer, not this callback", "");
    expect(body).not.toMatch(/paced|Paced|confirmChar|confirmName|nameHint/);
    // the one changed line: the job also gets the printer's name
    expect(rest.filter((l) => l.includes("nameHint"))).toEqual([
      "    void printJob(final byte[] data, final String address, final String nameHint, final Callback callback) {",
    ]);
  });

  it("the generic send keeps its numbers and its own pump", () => {
    const body = rest.join("\n");
    expect(body).toMatch(/private static final long SETTLE_MS = 1500;/);
    expect(body).toMatch(/private static final long PACING_MS = 8;/);
    expect(body).toMatch(/private static final int REQUEST_MTU = 512;/);
    expect(body).toMatch(/chunks = BleStickerLogic\.chunks\(payload, chunkSize\);/);
    expect(body).toMatch(/beginWrites\(BleStickerLogic\.clampChunkSize\(usable\)\);/);
    expect(body).toMatch(/if \(allSent\) finishOk\(\);/);
    expect(body).toMatch(/handler\.postDelayed\(pacingTimer, PACING_MS\);/);
    expect(read(`${DIR}BleStickerLogic.java`)).toMatch(/static final int MAX_CHUNK = 509;/);
  });

  it("the paced regions decide nothing by themselves: only PacedBleSend's driver sends or ends a paced job", () => {
    const inside = generic.split(OPEN).slice(1).map((part) => part.split(CLOSE)[0]).join("\n");
    expect(inside).toMatch(/paced = new PacedBleSend\.Driver\(session, pacedPhone\);/);
    expect(inside).toMatch(/PacedBleSend\.chunkSize\(negotiatedChunk\)/);
    // no piece size, pause or time-out number of its own
    expect(inside).not.toMatch(/postDelayed\([^,]+, \d+\)/);
    expect(inside).not.toMatch(/\b(180|509)\b/);
    // the same write call, type and API split as the generic pump
    expect(inside).toMatch(/gatt\.writeCharacteristic\(writeChar, piece, type\) == BluetoothStatusCodes\.SUCCESS/);
    expect(inside).toMatch(/writeNoResponse \? BluetoothGattCharacteristic\.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic\.WRITE_TYPE_DEFAULT/);
  });
});

describe("the plugin and the other printer code", () => {
  it("one generic print call, and it gets the name of the printer the job really goes to", () => {
    expect(plugin.split("generic().printJob(").length - 1).toBe(1);
    expect(plugin).toContain("generic().printJob(tspl, address, genericNameHint(call, address), r -> {");
    const hint = plugin.slice(plugin.indexOf("private String genericNameHint("), plugin.indexOf("/** Send ready TSPL bytes to a generic BLE printer"));
    // the saved name only when the job goes to the SAVED address — never for another printer under test
    expect(hint).toMatch(/address\.trim\(\)\.equalsIgnoreCase\(saved\.trim\(\)\)/);
    expect(hint).toMatch(/return isSaved \? prefs\(\)\.getString\(PREF_BT_NAME, ""\) : "";/);
    // the extra answer fields exist only for a paced job
    expect(plugin).toContain('if (r.paced) { ret.put("paced", true); ret.put("delivered", r.delivered); } // Y41BT');
    expect(plugin.split("PacedBleSend").length - 1).toBe(1); // only the comment of genericNameHint
    expect(plugin.split("r.paced").length - 1).toBe(1);
  });

  it("the AIMO D520BT, Niimbot, the text builder, the shared rules and the iPhone app never use it", () => {
    for (const f of ["BleStickerTransport.java", "NiimbotTransport.java", "TsplBuilder.java", "BleStickerLogic.java"]) {
      expect(read(DIR + f), f).not.toMatch(/PacedBleSend|pacedWanted|genericNameHint/);
    }
    expect(read("mobile/ios/App/App/SellerFlowPrinterPlugin.swift")).not.toMatch(/PacedBleSend|paced send/i);
    // the classic (paired) writer and the D520BT's own Bluetooth are called as before
    const classic = plugin.slice(plugin.indexOf("private void sendViaBluetoothSpp("), plugin.indexOf("protected void handleOnDestroy()"));
    expect(classic).not.toMatch(/paced|Paced/);
    expect(classic).toMatch(/try \{ Thread\.sleep\(180\); \} catch \(InterruptedException ignored\) \{\}/);
  });
});
