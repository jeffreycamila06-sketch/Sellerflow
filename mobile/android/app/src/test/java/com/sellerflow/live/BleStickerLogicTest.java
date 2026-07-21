package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
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
    public void clampChunkSize_mirrorsIos() {
        assertEquals(180, BleStickerLogic.clampChunkSize(0));      // unknown → MAX (iOS parity)
        assertEquals(180, BleStickerLogic.clampChunkSize(-5));     // non-positive → MAX
        assertEquals(180, BleStickerLogic.clampChunkSize(500));    // ceiling
        assertEquals(180, BleStickerLogic.clampChunkSize(180));
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
}
