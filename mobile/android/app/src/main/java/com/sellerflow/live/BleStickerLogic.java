package com.sellerflow.live;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure, hardware-free BLE helpers for the D520BT sticker printer — the exact
 * mirror of the iOS Swift {@code BleStickerLogic} enum
 * (mobile/ios/App/App/SellerFlowPrinterPlugin.swift). No Android/Bluetooth
 * imports, so it is unit-testable on the plain JVM via {@code ./gradlew test}
 * (see BleStickerLogicTest). Keep these three functions byte-for-byte behavior-
 * identical to the iOS versions.
 */
final class BleStickerLogic {
    /** Advertised service on the D520BT (FF00 is NOT advertised — verified). */
    static final String ADVERTISED_SERVICE = "AF30";
    /** Device-name prefix; the suffix varies per unit ("D520BT-Z", …). */
    static final String NAME_PREFIX = "D520BT";
    /** Proven-safe ceiling for write-without-response payloads on this printer. */
    static final int MAX_CHUNK = 180;
    /** BLE floor (ATT default MTU 23 − 3 ATT header). */
    static final int MIN_CHUNK = 20;

    private BleStickerLogic() {}

    /**
     * Usable chunk size: a reported max-write length clamped to [MIN_CHUNK,
     * MAX_CHUNK]; non-positive (unknown) → MAX_CHUNK default. Mirrors iOS
     * clampChunkSize exactly. NOTE: the Android transport never passes 0 (it
     * substitutes MIN_CHUNK for an unknown MTU); the 0→MAX branch exists only
     * for iOS parity + the unit test.
     */
    static int clampChunkSize(int reported) {
        if (reported <= 0) return MAX_CHUNK;
        return Math.max(MIN_CHUNK, Math.min(reported, MAX_CHUNK));
    }

    /**
     * Split the TSPL buffer into write-without-response chunks. Pure split: the
     * final chunk carries the remainder; concat(chunks(x)) == x exactly (no
     * padding, truncation, or reorder). Empty/null data → empty list.
     */
    static List<byte[]> chunks(byte[] data, int chunkSize) {
        List<byte[]> out = new ArrayList<>();
        if (data == null || data.length == 0) return out;
        int size = Math.max(1, chunkSize);
        int i = 0;
        while (i < data.length) {
            int end = Math.min(i + size, data.length);
            byte[] part = new byte[end - i];
            System.arraycopy(data, i, part, 0, end - i);
            out.add(part);
            i = end;
        }
        return out;
    }

    /**
     * Success signal: the ACCUMULATED FF03 ASCII stream contains "PRINTING:DONE".
     * Suffix-tolerant (the printer sends e.g. "SSGETPRINTING:DONE") and split-
     * tolerant (a status line can arrive across several notifications — callers
     * accumulate, we just match). Case-insensitive.
     */
    static boolean containsPrintDone(String buffer) {
        if (buffer == null) return false;
        return buffer.toUpperCase(Locale.US).contains("PRINTING:DONE");
    }

    /**
     * Scan filter: advertised service AF30 (16-bit "AF30" or full-128
     * "0000AF30-…" form) OR name prefix "D520BT" (case-insensitive). NEVER FF00 —
     * it is not advertised. Mirrors iOS isTargetPrinter.
     */
    static boolean isTargetPrinter(String name, List<String> advertisedServices) {
        if (advertisedServices != null) {
            for (String raw : advertisedServices) {
                if (raw == null) continue;
                String s = raw.toUpperCase(Locale.US);
                if (s.equals(ADVERTISED_SERVICE) || s.startsWith("0000" + ADVERTISED_SERVICE + "-")) return true;
            }
        }
        if (name != null && name.toUpperCase(Locale.US).startsWith(NAME_PREFIX)) return true;
        return false;
    }
}
