package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/**
 * Pure JVM unit tests for BleStickerLogic — the only unit-testable surface of
 * the Android BLE transport (CI cannot build/run the native GATT path; that is
 * validated on-device). Mirrors the iOS BleStickerLogicTests. Runs via
 * `./gradlew test` (junit is on testImplementation).
 */
public class BleStickerLogicTest {

    @Test
    public void isTargetPrinter_matchesServiceAndName_neverFF00() {
        // name-prefix match (case-insensitive, suffix varies per unit)
        assertTrue(BleStickerLogic.isTargetPrinter("D520BT-Z", Collections.emptyList()));
        assertTrue(BleStickerLogic.isTargetPrinter("d520bt", Collections.emptyList()));
        // advertised AF30 in 16-bit and full-128 forms
        assertTrue(BleStickerLogic.isTargetPrinter(null, Collections.singletonList("AF30")));
        assertTrue(BleStickerLogic.isTargetPrinter(null, Collections.singletonList("af30")));
        assertTrue(BleStickerLogic.isTargetPrinter(null, Collections.singletonList("0000af30-0000-1000-8000-00805f9b34fb")));
        // FF00 is NOT advertised → must never match on service
        assertFalse(BleStickerLogic.isTargetPrinter(null, Collections.singletonList("FF00")));
        assertFalse(BleStickerLogic.isTargetPrinter(null, Collections.singletonList("0000ff00-0000-1000-8000-00805f9b34fb")));
        // unrelated device
        assertFalse(BleStickerLogic.isTargetPrinter("SomePhone", Collections.singletonList("180A")));
        assertFalse(BleStickerLogic.isTargetPrinter(null, Collections.emptyList()));
        assertFalse(BleStickerLogic.isTargetPrinter(null, null));
    }

    @Test
    public void clampChunkSize_sdkParityCeiling509() {
        // MAX_CHUNK = 509 = the supplier SDK's own chunk (MTU 512 − 3), proven
        // accepted by both board generations (the SDK gates connect on it).
        assertEquals(509, BleStickerLogic.clampChunkSize(0));      // unknown → MAX
        assertEquals(509, BleStickerLogic.clampChunkSize(-5));     // non-positive → MAX
        assertEquals(509, BleStickerLogic.clampChunkSize(600));    // ceiling
        assertEquals(509, BleStickerLogic.clampChunkSize(509));    // MTU-512 grant → full 509
        assertEquals(244, BleStickerLogic.clampChunkSize(244));    // MTU-247 grant passthrough
        assertEquals(20, BleStickerLogic.clampChunkSize(20));      // floor value
        assertEquals(20, BleStickerLogic.clampChunkSize(5));       // below floor → MIN
        assertEquals(100, BleStickerLogic.clampChunkSize(100));    // in-range passthrough
    }

    @Test
    public void chunks_concatIdentity_noPaddingTruncationReorder() throws Exception {
        byte[] data = new byte[455];
        for (int i = 0; i < data.length; i++) data[i] = (byte) (i % 256);
        for (int cs : new int[] {1, 20, 64, 179, 180, 181, 455, 1000}) {
            List<byte[]> parts = BleStickerLogic.chunks(data, cs);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            for (byte[] p : parts) bos.write(p, 0, p.length);
            // concat(chunks(x)) == x exactly — the print-correctness guarantee
            assertArrayEquals("chunkSize=" + cs, data, bos.toByteArray());
            // no chunk exceeds the requested size
            int max = Math.max(1, cs);
            for (byte[] p : parts) assertTrue("chunkSize=" + cs + " part=" + p.length, p.length <= max && p.length > 0);
        }
    }

    @Test
    public void chunks_boundaryCounts() {
        assertEquals(0, BleStickerLogic.chunks(new byte[0], 20).size());
        assertEquals(0, BleStickerLogic.chunks(null, 20).size());
        assertEquals(1, BleStickerLogic.chunks(new byte[20], 20).size());   // exact fit → 1
        assertEquals(2, BleStickerLogic.chunks(new byte[21], 20).size());   // remainder → +1
        assertEquals(5, BleStickerLogic.chunks(new byte[100], 20).size());
    }

    @Test
    public void containsPrintDone_suffixAndSplitTolerant() {
        assertTrue(BleStickerLogic.containsPrintDone("SSGETPRINTING:DONE"));      // printer's real suffix form
        assertTrue(BleStickerLogic.containsPrintDone("printing:done"));           // case-insensitive
        assertTrue(BleStickerLogic.containsPrintDone("noise\r\nPRINTING:DONE\r\n")); // embedded
        assertFalse(BleStickerLogic.containsPrintDone("PRINTING:"));              // partial (split arrival, not yet complete)
        assertFalse(BleStickerLogic.containsPrintDone("DONE"));
        assertFalse(BleStickerLogic.containsPrintDone(""));
        assertFalse(BleStickerLogic.containsPrintDone(null));
    }

    @Test
    public void chunks_matchIosSampleShape() {
        // A 400-byte payload at MTU-derived 180 → [180,180,40].
        List<byte[]> parts = BleStickerLogic.chunks(new byte[400], 180);
        assertEquals(3, parts.size());
        assertEquals(180, parts.get(0).length);
        assertEquals(180, parts.get(1).length);
        assertEquals(40, parts.get(2).length);
    }

    // ── Generic BLE printers (Phase 1) ──────────────────────────────────────

    private static final int W = BleStickerLogic.PROP_WRITE;
    private static final int WNR = BleStickerLogic.PROP_WRITE_NO_RESPONSE;
    private static final int N = BleStickerLogic.PROP_NOTIFY;
    private static final String BASE = "-0000-1000-8000-00805f9b34fb";
    private static String u16(String s) { return "0000" + s.toLowerCase() + BASE; }
    private static BleStickerLogic.Chr chr(String uuid, int props) { return new BleStickerLogic.Chr(uuid, props); }
    private static BleStickerLogic.Svc svc(String uuid, BleStickerLogic.Chr... cs) { return new BleStickerLogic.Svc(uuid, new ArrayList<>(Arrays.asList(cs))); }

    @Test
    public void isLikelyPrinter_byServiceOnly() {
        assertTrue(BleStickerLogic.isLikelyPrinter(Arrays.asList("FEE7", "18F0")));              // Y41BT
        assertTrue(BleStickerLogic.isLikelyPrinter(Arrays.asList(u16("FEE7"), u16("18F0"))));    // full-128 form
        assertTrue(BleStickerLogic.isLikelyPrinter(Collections.singletonList("AF30")));          // D520BT
        assertTrue(BleStickerLogic.isLikelyPrinter(Collections.singletonList("49535343-fe7d-4ae5-8fa9-9fafd205e455")));
        assertFalse(BleStickerLogic.isLikelyPrinter(Collections.emptyList()));
        assertFalse(BleStickerLogic.isLikelyPrinter(Collections.singletonList("180D")));         // heart rate
        assertFalse(BleStickerLogic.isLikelyPrinter(null));
    }

    @Test
    public void pickWriteTarget_y41btLayout_ff00ff02_withBothNotifies() {
        List<BleStickerLogic.Svc> y41 = Arrays.asList(
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc(u16("FF00"), chr(u16("FF02"), W | WNR), chr(u16("FF01"), N), chr(u16("FF03"), N)),
            svc(u16("FF10"), chr(u16("FF11"), W)),
            svc(u16("FF80"), chr(u16("FF82"), WNR)),
            svc(u16("FFF0"), chr(u16("FFF2"), W)),
            svc("49535343-fe7d-4ae5-8fa9-9fafd205e455", chr("49535343-8841-43f4-a8d4-ecbe34729bb3", W)));
        BleStickerLogic.WriteTarget t = BleStickerLogic.pickWriteTarget(y41);
        assertEquals("FF00", t.service);
        assertEquals("FF02", t.writeChar);
        assertEquals(Arrays.asList("FF01", "FF03"), t.notifyChars);
        assertTrue(t.writeNoResponse());
    }

    @Test
    public void pickWriteTarget_only18f0() {
        BleStickerLogic.WriteTarget t = BleStickerLogic.pickWriteTarget(Collections.singletonList(
            svc(u16("18F0"), chr(u16("2AF0"), N), chr(u16("2AF1"), W))));
        assertEquals("18F0", t.service);
        assertEquals("2AF1", t.writeChar);
        assertEquals(Collections.singletonList("2AF0"), t.notifyChars);
        assertFalse(t.writeNoResponse());
    }

    @Test
    public void pickWriteTarget_heartRateOnly_null() {
        assertNull(BleStickerLogic.pickWriteTarget(Collections.singletonList(
            svc(u16("180D"), chr(u16("2A37"), N), chr(u16("2A38"), 0x02)))));
        assertNull(BleStickerLogic.pickWriteTarget(Collections.emptyList()));
        assertNull(BleStickerLogic.pickWriteTarget(null));
    }

    @Test
    public void pickWriteTarget_never1800or1801() {
        // Only Generic Access / Generic Attribute are writable → nothing to pick.
        assertNull(BleStickerLogic.pickWriteTarget(Arrays.asList(
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc(u16("1801"), chr(u16("2A05"), W | N)))));
        // With another writable service, that one wins even though 1800 comes first.
        BleStickerLogic.WriteTarget t = BleStickerLogic.pickWriteTarget(Arrays.asList(
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc("12345678-1234-1234-1234-1234567890ab", chr("aaaaaaaa-1234-1234-1234-1234567890ab", WNR))));
        assertEquals("12345678-1234-1234-1234-1234567890AB", t.service);
        assertEquals("AAAAAAAA-1234-1234-1234-1234567890AB", t.writeChar);
    }

    @Test
    public void pickWriteTarget_preferredCharMustBeWritable() {
        // FF00 present but FF02 not writable → next preference (FFF0/FFF2).
        BleStickerLogic.WriteTarget t = BleStickerLogic.pickWriteTarget(Arrays.asList(
            svc(u16("FF00"), chr(u16("FF02"), N)),
            svc(u16("FFF0"), chr(u16("FFF2"), W))));
        assertEquals("FFF0", t.service);
        assertEquals("FFF2", t.writeChar);
    }

    @Test
    public void toHexCapped_capsLength() {
        assertEquals("53532F", BleStickerLogic.toHexCapped(new byte[] {0x53, 0x53, 0x2F}, 256));
        assertEquals(256, BleStickerLogic.toHexCapped(new byte[400], 256).length());
        assertEquals("", BleStickerLogic.toHexCapped(null, 256));
    }

    // ── Printer-name list (printer setup v2) ─────────────────────────────────

    @Test
    public void isPrinterName_matchesListCaseInsensitive() {
        for (String n : new String[] {"B1-I603042141", "b21-ABC", "D110-1234", "XP-P323B", "Xprinter_58", "Printer_8A2F",
                "PRT-200", "PT-210", "MPT-II", "GP-1324D", "HM-A300", "M110-C9", "M02S", "Q30_01", "T02-xx",
                "HPRT N41", "Munbyn ITPP941", "RPP02N", "Gprinter GP-3120", "Zjiang ZJ-5802"}) {
            assertTrue(n, BleStickerLogic.isPrinterName(n));
        }
    }

    @Test
    public void isPrinterName_excludesHeartRateHeadphonesWatchLaptop() {
        for (String n : new String[] {"Polar H10 1234", "WH-1000XM4", "Galaxy Watch4", "Jeff MacBook Pro", "Pixel 8", "AirPods Pro", "Mi Band 7", "", "   "}) {
            assertFalse(n, BleStickerLogic.isPrinterName(n));
        }
        assertFalse(BleStickerLogic.isPrinterName(null));
    }

    @Test
    public void isNiimbotName_onlyNiimbotModels() {
        assertTrue(BleStickerLogic.isNiimbotName("B1-I603042141"));
        assertTrue(BleStickerLogic.isNiimbotName("d11-0001"));
        assertFalse(BleStickerLogic.isNiimbotName("XP-P323B"));
        assertFalse(BleStickerLogic.isNiimbotName("Y41BT-0FC4_LE"));
        assertFalse(BleStickerLogic.isNiimbotName(null));
        // every Niimbot prefix is also on the printer list
        for (String p : BleStickerLogic.NIIMBOT_NAME_PREFIXES) assertTrue(p, Arrays.asList(BleStickerLogic.PRINTER_NAME_PREFIXES).contains(p));
    }
}
