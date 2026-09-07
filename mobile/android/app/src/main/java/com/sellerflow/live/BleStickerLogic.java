package com.sellerflow.live;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure, hardware-free BLE helpers for the D520BT sticker printer — the mirror
 * of the iOS Swift {@code BleStickerLogic} enum
 * (mobile/ios/App/App/SellerFlowPrinterPlugin.swift). No Android/Bluetooth
 * imports, so it is unit-testable on the plain JVM via {@code ./gradlew test}
 * (see BleStickerLogicTest). isTargetPrinter/chunks/containsPrintDone stay
 * byte-for-byte behavior-identical to the iOS versions; MAX_CHUNK is
 * DELIBERATELY ahead of iOS (509 vs 180) after the supplier-SDK evidence below —
 * bring iOS up to match in the Phase-2 parity pass.
 */
final class BleStickerLogic {
    /** Advertised service on the D520BT (FF00 is NOT advertised — verified). */
    static final String ADVERTISED_SERVICE = "AF30";
    /** Device-name prefix; the suffix varies per unit ("D520BT-Z", …). */
    static final String NAME_PREFIX = "D520BT";
    /**
     * Chunk ceiling = the supplier SDK's own value (decompiled mprinter AAR,
     * BleBluetooth: {@code sjo = SDK_INT>=24 ? 509 : 182}, requestMtu(512)).
     * The SDK refuses to finish connecting unless the printer grants MTU 512
     * (it retries 5×) — hardware proof that BOTH board generations accept
     * 509-byte packets. The old 180 cap made every sticker ~2.8× more chunks
     * than Labelife sends. Still clamped by the actual negotiated MTU below,
     * so a stack that grants less just uses less.
     */
    static final int MAX_CHUNK = 509;
    /** BLE floor (ATT default MTU 23 − 3 ATT header). */
    static final int MIN_CHUNK = 20;

    private BleStickerLogic() {}

    /**
     * Usable chunk size: a reported max-write length clamped to [MIN_CHUNK,
     * MAX_CHUNK]; non-positive (unknown) → MAX_CHUNK default. Same shape as the
     * iOS clampChunkSize (ceiling differs — see MAX_CHUNK). NOTE: the Android
     * transport never passes 0 (it substitutes MIN_CHUNK for an unknown MTU);
     * the 0→MAX branch exists only for shape parity + the unit test.
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
