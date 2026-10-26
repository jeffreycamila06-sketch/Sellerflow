package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Pure JVM unit tests for the Niimbot 1:1 frame math — the only unit-testable surface of the
 * Android Niimbot transport (the SDK print path is validated on-device). Mirrors the iOS
 * NiimbotLoaderTests.testBmpIsExactlyTheFrameDots. Runs via `./gradlew testDebugUnitTest`.
 */
public class NiimbotTransportTest {

    @Test
    public void frameInsetMatchesIosAndWeb() {
        assertEquals(1f, NiimbotTransport.FRAME_INSET_MM, 0f);   // iOS NiimbotImage.frameInsetMm / web NIIMBOT_FRAME_INSET_MM
        assertEquals(8, NiimbotTransport.DOTS_PER_MM);
    }

    @Test
    public void frameDots_50x30_is384x224() {
        assertArrayEquals(new int[] { 384, 224 }, NiimbotTransport.frameDots(50f, 30f));
        assertArrayEquals(new int[] { (50 - 2) * 8, (30 - 2) * 8 }, NiimbotTransport.frameDots(50f, 30f));
        assertArrayEquals(new int[] { 464, 304 }, NiimbotTransport.frameDots(60f, 40f));
    }

    @Test
    public void sizeMismatch_nullWhenTheImageIsTheFrame_loggedOtherwise() {
        assertNull(NiimbotTransport.sizeMismatch(384, 224, 50f, 30f));         // what the web sends now
        String old = NiimbotTransport.sizeMismatch(384, 240, 50f, 30f);        // the label-sized raster of an older bundle
        assertTrue(old, old.startsWith("SIZE MISMATCH image 384x240 != frame 384x224 dots"));
        assertTrue(old, old.contains("label 50x30 mm, inset 1 mm"));
        assertTrue(NiimbotTransport.sizeMismatch(400, 240, 50f, 30f).contains("400x240"));
    }
}
