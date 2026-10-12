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

    // ── Generic BLE label printers (Phase 1, test-gated) ─────────────────────
    // Pure helpers for printers that speak TSPL like the D520BT but are found by
    // CAPABILITY (advertised / discovered GATT services), never by brand name.
    // isTargetPrinter above stays the D520BT gate and is not used here.

    /** GATT characteristic property bits (android.bluetooth values, copied so this stays pure). */
    static final int PROP_WRITE_NO_RESPONSE = 0x04;
    static final int PROP_WRITE = 0x08;
    static final int PROP_NOTIFY = 0x10;

    private static final String BASE_UUID_TAIL = "-0000-1000-8000-00805F9B34FB";

    /** "ff00", "0000FF00-0000-1000-8000-00805f9b34fb" → "FF00"; any other UUID → its upper-case form. */
    static String normUuid(String raw) {
        if (raw == null) return "";
        String s = raw.trim().toUpperCase(Locale.US);
        if (s.length() == 36 && s.startsWith("0000") && s.endsWith(BASE_UUID_TAIL)) return s.substring(4, 8);
        return s;
    }

    /** Services seen on BLE label printers (D520BT, Y41BT, common TSPL/ESC-POS chips). */
    static final List<String> LIKELY_PRINTER_SERVICES = java.util.Arrays.asList(
        "AF30", "18F0", "FF00", "FFF0", "FF80",
        "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2",
        "49535343-FE7D-4AE5-8FA9-9FAFD205E455");

    /** True when any advertised service is a known printer service. Never matches by name. */
    static boolean isLikelyPrinter(List<String> advertisedServices) {
        if (advertisedServices == null) return false;
        for (String raw : advertisedServices) {
            if (LIKELY_PRINTER_SERVICES.contains(normUuid(raw))) return true;
        }
        return false;
    }

    static final class Chr {
        final String uuid;
        final int props;
        Chr(String uuid, int props) { this.uuid = uuid; this.props = props; }
        boolean writable() { return (props & (PROP_WRITE | PROP_WRITE_NO_RESPONSE)) != 0; }
        boolean notifies() { return (props & PROP_NOTIFY) != 0; }
    }

    static final class Svc {
        final String uuid;
        final List<Chr> chars;
        Svc(String uuid, List<Chr> chars) { this.uuid = uuid; this.chars = chars; }
    }

    static final class WriteTarget {
        final String service;
        final String writeChar;
        final int writeProps;
        final List<String> notifyChars;
        WriteTarget(String service, String writeChar, int writeProps, List<String> notifyChars) {
            this.service = service; this.writeChar = writeChar; this.writeProps = writeProps; this.notifyChars = notifyChars;
        }
        boolean writeNoResponse() { return (writeProps & PROP_WRITE_NO_RESPONSE) != 0; }
    }

    /** Preferred (service, write characteristic) pairs, in order. */
    static final String[][] PREFERRED_WRITE = {
        {"FF00", "FF02"},
        {"18F0", "2AF1"},
        {"FFF0", "FFF2"},
        {"49535343-FE7D-4AE5-8FA9-9FAFD205E455", "49535343-8841-43F4-A8D4-ECBE34729BB3"},
        {"E7810A71-73AE-499D-8C15-FAA9AEF0C3F2", "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F"},
    };

    /**
     * Where to write TSPL on a discovered printer: the first preferred pair whose
     * characteristic is writable, else the first writable characteristic in any
     * service except Generic Access (1800) / Generic Attribute (1801). notifyChars =
     * every NOTIFY characteristic in the chosen service. null = nothing writable.
     */
    static WriteTarget pickWriteTarget(List<Svc> services) {
        if (services == null) return null;
        for (String[] pair : PREFERRED_WRITE) {
            for (Svc svc : services) {
                if (svc == null || !pair[0].equals(normUuid(svc.uuid))) continue;
                for (Chr c : svc.chars) {
                    if (c != null && pair[1].equals(normUuid(c.uuid)) && c.writable()) return target(svc, c);
                }
            }
        }
        for (Svc svc : services) {
            if (svc == null) continue;
            String su = normUuid(svc.uuid);
            if (su.equals("1800") || su.equals("1801")) continue;
            for (Chr c : svc.chars) if (c != null && c.writable()) return target(svc, c);
        }
        return null;
    }

    private static WriteTarget target(Svc svc, Chr write) {
        List<String> notify = new ArrayList<>();
        for (Chr c : svc.chars) if (c != null && c.notifies()) notify.add(normUuid(c.uuid));
        return new WriteTarget(normUuid(svc.uuid), normUuid(write.uuid), write.props, notify);
    }

    /** Raw bytes → upper-case hex, at most maxChars characters. */
    static String toHexCapped(byte[] data, int maxChars) {
        if (data == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : data) {
            if (sb.length() + 2 > maxChars) break;
            sb.append(String.format(Locale.US, "%02X", b & 0xFF));
        }
        return sb.toString();
    }
}
