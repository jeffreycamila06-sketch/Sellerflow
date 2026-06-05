package com.sellerflow.live;

import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * TSPL (TSC Printer Language) command stream builder for AIMO-class label
 * printers like the AIMO D520BT. Used by SellerFlowPrinterPlugin.printSticker
 * to emit a complete print job that the printer can consume in one socket
 * write.
 *
 * Pipeline:
 *   1. Frontend renders the same web/slip HTML to a 1-bit-per-pixel bitmap at
 *      100x60mm @ 203 DPI (800x480 dots), packed into widthBytes*heightDots
 *      bytes where each bit set = printed dot.
 *   2. The bytes are base64-encoded and handed off via the Capacitor plugin
 *      method printSticker({bitmapBase64, widthDots, heightDots}).
 *   3. This builder decodes the base64 and wraps the raw bytes in:
 *         SIZE 100 mm, 60 mm
 *         GAP 2 mm, 0
 *         DIRECTION 1
 *         CLS
 *         BITMAP 0,0,<widthBytes>,<heightDots>,0,<binary bitmap bytes>
 *         PRINT 1
 *      where <binary bitmap bytes> is the raw byte stream (NOT base64),
 *      sandwiched between the ASCII BITMAP header and a trailing \r\n.
 *   4. The full byte[] is written to the BluetoothSocket OutputStream in one
 *      go via Classic Bluetooth SPP (UUID 00001101-0000-1000-8000-00805F9B34FB).
 *
 * Encoding note: TSPL commands are ASCII / GBK, line-terminated with \r\n. The
 * BITMAP data is binary (cannot be UTF-8 mangled), so we use a single
 * ByteArrayOutputStream and write ASCII command frames + raw bytes directly.
 * Avoid String concatenation around the bitmap payload.
 */
class TsplBuilder {

    private static final byte[] CRLF = new byte[]{'\r', '\n'};

    /**
     * Build a full TSPL job for a 100x60mm label at 203 DPI from a base64-
     * encoded 1-bit packed bitmap. widthDots must be a multiple of 8 (the
     * frontend renderer enforces this; common values: 800 for 100mm).
     */
    static byte[] forSticker(String bitmapBase64, int widthDots, int heightDots,
                             int labelWidthMm, int labelHeightMm) throws IllegalArgumentException {
        if (bitmapBase64 == null || bitmapBase64.isEmpty()) {
            throw new IllegalArgumentException("bitmapBase64 is required");
        }
        if (widthDots <= 0 || heightDots <= 0) {
            throw new IllegalArgumentException("widthDots/heightDots must be > 0");
        }
        if (labelWidthMm <= 0 || labelHeightMm <= 0) {
            throw new IllegalArgumentException("label dimensions must be > 0");
        }
        byte[] bitmap = Base64.decode(bitmapBase64, Base64.DEFAULT);
        int widthBytes = (widthDots + 7) / 8;
        int expected = widthBytes * heightDots;
        if (bitmap.length != expected) {
            throw new IllegalArgumentException(
                "bitmap byte count " + bitmap.length + " does not match widthDots/heightDots (expected " + expected + ")"
            );
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream(bitmap.length + 256);
        writeAscii(out, "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        writeAscii(out, "GAP 2 mm, 0");
        writeAscii(out, "DIRECTION 1");
        writeAscii(out, "REFERENCE 0,0");
        writeAscii(out, "DENSITY 8");
        writeAscii(out, "CLS");
        // BITMAP header: x, y, widthBytes, heightDots, mode (0 = OVERWRITE)
        // The header itself is ASCII; right after the trailing comma comes the
        // raw binary bitmap stream, then CRLF.
        writeBytes(out, ("BITMAP 0,0," + widthBytes + "," + heightDots + ",0,").getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, bitmap);
        writeBytes(out, CRLF);
        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    /**
     * Minimal text-only test page. Used by testStickerPrint() to verify the
     * printer + Bluetooth pipeline without involving the bitmap renderer.
     * Independent of the frontend so it works even if the WebView is closed.
     */
    static byte[] textTestPage(String storeName, int labelWidthMm, int labelHeightMm) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(256);
        writeAscii(out, "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        writeAscii(out, "GAP 2 mm, 0");
        writeAscii(out, "DIRECTION 1");
        writeAscii(out, "REFERENCE 0,0");
        writeAscii(out, "DENSITY 8");
        writeAscii(out, "CLS");
        writeAscii(out, "TEXT 20,20,\"4\",0,1,1,\"SellerFlowLive\"");
        writeAscii(out, "TEXT 20,80,\"3\",0,1,1,\"Bluetooth printer OK\"");
        writeAscii(out, "TEXT 20,140,\"3\",0,1,1,\"" + safe(storeName) + "\"");
        writeAscii(out, "TEXT 20,200,\"2\",0,1,1,\"" + nowStamp() + "\"");
        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    /**
     * Diagnostic: drawing-primitive-only test page using BAR (solid rectangle)
     * commands — no BITMAP, no bitmap binary data. Used to confirm whether the
     * printer's TSPL graphics layer works at all when the BITMAP command path
     * is suspect (e.g., AIMO D520BT firmware that accepts TEXT but ignores
     * BITMAP). Draws a recognizable frame + crossbar pattern:
     *   ┌──────────────┐
     *   │              │
     *   │  ===bar===   │   (filled bar across the middle)
     *   │              │
     *   └──────────────┘
     * If THIS prints, BAR works and we can pivot from BITMAP-based image
     * encoding to a BAR-decomposition pipeline (one BAR per black run on
     * each row, or per-region rectangles). If even BAR is blank, the printer
     * accepts only TEXT and we need a fundamentally different protocol
     * (CPCL or ESC/POS raster).
     *
     * Note: TSPL BAR x,y,width,height expects dots. At 203 DPI a 100mm wide
     * label = 800 dots and a 60mm tall label = 480 dots, so we use a hard
     * 800x480 frame with 40-dot-thick borders and a 80-dot crossbar.
     */
    static byte[] barTestPage(String storeName, int labelWidthMm, int labelHeightMm) {
        int widthDots = labelWidthMm * 8;    // 203 DPI rounded -> 8 dots/mm
        int heightDots = labelHeightMm * 8;
        ByteArrayOutputStream out = new ByteArrayOutputStream(384);
        writeAscii(out, "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        writeAscii(out, "GAP 2 mm, 0");
        writeAscii(out, "DIRECTION 1");
        writeAscii(out, "REFERENCE 0,0");
        writeAscii(out, "DENSITY 8");
        writeAscii(out, "CLS");
        // Frame: top, bottom, left, right (each 40 dots thick)
        writeAscii(out, "BAR 0,0," + widthDots + ",40");
        writeAscii(out, "BAR 0," + (heightDots - 40) + "," + widthDots + ",40");
        writeAscii(out, "BAR 0,0,40," + heightDots);
        writeAscii(out, "BAR " + (widthDots - 40) + ",0,40," + heightDots);
        // Middle crossbar (centered, 80 dots tall)
        int barY = (heightDots - 80) / 2;
        writeAscii(out, "BAR 80," + barY + "," + (widthDots - 160) + ",80");
        // Caption above the bar
        writeAscii(out, "TEXT 60," + (barY - 60) + ",\"3\",0,1,1,\"BAR test OK\"");
        writeAscii(out, "TEXT 60," + (barY + 100) + ",\"2\",0,1,1,\"" + safe(storeName) + "\"");
        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    private static String safe(String s) {
        if (s == null) return "";
        // TSPL TEXT uses " as the value delimiter; escape any internal quotes.
        return s.replace("\"", "'");
    }

    private static String nowStamp() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
            .format(new java.util.Date());
    }

    private static void writeAscii(ByteArrayOutputStream out, String s) {
        writeBytes(out, s.getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, CRLF);
    }

    private static void writeBytes(ByteArrayOutputStream out, byte[] data) {
        out.write(data, 0, data.length);
    }
}
