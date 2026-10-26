package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.bluetooth.BluetoothDevice;

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

    // ── Classic-device resolution (the Oct 26 B1 bug: an LE-scan row paired over LE and the B1 refused) ──
    @Test
    public void sameDeviceName_ignoresCaseAndWhitespace_neverMatchesBlank() {
        assertTrue(NiimbotTransport.sameDeviceName("B1-I603042141", " b1-i603042141 "));
        assertFalse(NiimbotTransport.sameDeviceName("B1-I603042141", "B1-I603042142"));
        assertFalse(NiimbotTransport.sameDeviceName("", ""));
        assertFalse(NiimbotTransport.sameDeviceName(null, "B1"));
        assertFalse(NiimbotTransport.sameDeviceName("B1", null));
    }

    @Test
    public void isClassicType_onlyClassicOrDualCanCarrySpp() {
        assertTrue(NiimbotTransport.isClassicType(BluetoothDevice.DEVICE_TYPE_CLASSIC));
        assertTrue(NiimbotTransport.isClassicType(BluetoothDevice.DEVICE_TYPE_DUAL));
        assertFalse(NiimbotTransport.isClassicType(BluetoothDevice.DEVICE_TYPE_LE));      // the B1 as the BLE scan cached it (dev_type=0x2)
        assertFalse(NiimbotTransport.isClassicType(BluetoothDevice.DEVICE_TYPE_UNKNOWN));
    }

    @Test
    public void isOurClassicPrinter_byNameOrRowAddress_classicOnly() {
        final String name = "B1-I603042141", leAddr = "03:06:04:74:F2:C2";
        assertTrue(NiimbotTransport.isOurClassicPrinter(BluetoothDevice.DEVICE_TYPE_DUAL, "B1-I603042141", "03:06:04:74:F2:C3", name, leAddr));   // same name, other (BR/EDR) address
        assertTrue(NiimbotTransport.isOurClassicPrinter(BluetoothDevice.DEVICE_TYPE_CLASSIC, null, leAddr, name, leAddr));                    // same address, name not read yet
        assertFalse(NiimbotTransport.isOurClassicPrinter(BluetoothDevice.DEVICE_TYPE_LE, "B1-I603042141", leAddr, name, leAddr));             // the LE entry is never it
        assertFalse(NiimbotTransport.isOurClassicPrinter(BluetoothDevice.DEVICE_TYPE_DUAL, "D520BT-Z", "8C:C6:A4:D7:35:A1", name, leAddr));   // another printer
    }

    @Test
    public void bondOutcome_bondedIsDone_bondingThenNoneIsDeclinedAtOnce_elseWait() {
        assertEquals(NiimbotTransport.BOND_DONE, NiimbotTransport.bondOutcome(false, BluetoothDevice.BOND_BONDED));
        assertEquals(NiimbotTransport.BOND_DONE, NiimbotTransport.bondOutcome(true, BluetoothDevice.BOND_BONDED));
        assertEquals(NiimbotTransport.BOND_DECLINED, NiimbotTransport.bondOutcome(true, BluetoothDevice.BOND_NONE)); // BONDING → NONE: no 20 s wait
        assertEquals(NiimbotTransport.BOND_WAIT, NiimbotTransport.bondOutcome(false, BluetoothDevice.BOND_NONE));    // not started yet
        assertEquals(NiimbotTransport.BOND_WAIT, NiimbotTransport.bondOutcome(true, BluetoothDevice.BOND_BONDING));
        assertTrue(NiimbotTransport.CLASSIC_DISCOVERY_MS <= 13_000L);
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
