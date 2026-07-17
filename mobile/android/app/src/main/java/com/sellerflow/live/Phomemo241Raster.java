package com.sellerflow.live;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;

/**
 * Android glyph rasterizer for the Phomemo 241 band path — the ONLY
 * android.graphics dependency of the 241 feature. Implements
 * {@link Phomemo241Builder.BandRenderer}: draws a text run into an off-screen
 * bitmap and packs it (1-bit, 180-rotated) via the pure
 * {@link Phomemo241Builder#packBits}. Mirrors the shipped iOS
 * {@code render241TextBand} (UIGraphicsImageRenderer + PingFang TC) — here with
 * Bitmap/Canvas + the system default Typeface, which on minSdk 24 is Noto CJK
 * (Traditional-correct for Chinese). 1 point = 1 pixel = 1 printer dot (203dpi).
 *
 * ⚠️ NOT byte-identical to iOS: Noto CJK (Android) vs PingFang TC (iOS) are
 * different fonts — visually equivalent, not bit-equal. That is expected and why
 * the 241 fork is deliberately excluded from the cross-language golden set; the
 * layout (positions/commands) is JVM-parity-tested, the glyph bitmap is
 * device-verified only (the Mac/JVM runtime cannot prove printer glyph output).
 *
 * The band TARGET size is a base glyph cell STRETCHED by (xMul, yMul) — the same
 * thing the AIMO TEXT ...,xMul,yMul stretch does — so the LETTER grows with the
 * scale (not just whitespace) and a wide string compresses instead of clipping.
 */
final class Phomemo241Raster implements Phomemo241Builder.BandRenderer {

    private static final int BASE_CELL = 24;   // ~ TSPL font "4" at 1x

    @Override
    public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxWidthDots) {
        if (text == null || text.isEmpty() || xMul <= 0 || yMul <= 0 || maxWidthDots <= 0) return null;

        // Height in PIXELS from the EXACT decimal (24 x yMul), so every 0.1 step of
        // the seller size adjuster changes the rendered glyph (BUG 3) — a
        // rotation-180 TEXT multiplier the 241 ignores, a pixel dimension it can't.
        int outH = Math.max(1, Math.round((float) (BASE_CELL * yMul)));
        boolean isCjk = containsCjk(text);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);

        Bitmap bmp;
        int outW;
        if (isCjk) {
            // CJK — system default typeface resolves to Noto CJK on minSdk 24
            // (Traditional-correct). Sized at outH x 0.82, width natural + clipped.
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize((float) (outH * 0.82));
            float measured = paint.measureText(text);
            int w = Math.min((int) Math.ceil(measured), maxWidthDots);
            if (w <= 0) return null;
            outW = w;
            bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawColor(Color.WHITE);
            Paint.FontMetrics fm = paint.getFontMetrics();
            float textH = fm.descent - fm.ascent;
            float top = Math.max(0f, (outH - textH) / 2f);
            canvas.drawText(text, 0f, top - fm.ascent, paint);   // baseline placed so the run is vertically centered
        } else {
            // ASCII/Latin — monospace bold (closest to the TSPL ROM look), sized so
            // the FULL glyph (ascender-top DOWN TO descender-bottom) fits the base
            // cell, then STRETCH by (xMul, yMul) so the letter itself grows. Fitting
            // the whole ascent+descent extent (not just cap height) keeps the "y" in
            // "Buyer" and g/p/q/j from clipping at the bottom at every band scale.
            paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
            paint.setTextSize(100f);
            Paint.FontMetrics ref = paint.getFontMetrics();
            float extent = Math.max(0.5f, ref.descent - ref.ascent);   // ascent is negative
            paint.setTextSize(100f * (BASE_CELL / extent));
            Paint.FontMetrics fm = paint.getFontMetrics();
            float measured = paint.measureText(text);
            if (measured < 1f) return null;
            outW = Math.min((int) Math.ceil(measured * xMul), maxWidthDots);
            if (outW <= 0) return null;
            float hStretch = outW / measured;   // = xMul unless width-clamped
            bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawColor(Color.WHITE);
            canvas.save();
            canvas.scale(hStretch, (float) yMul);   // base coords: glyph occupies [0, BASE_CELL] in y
            canvas.drawText(text, 0f, -fm.ascent, paint);   // ascent-top → 0, descender-bottom → BASE_CELL
            canvas.restore();
        }

        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] pixels = new int[w * h];
        bmp.getPixels(pixels, 0, w, 0, 0, w, h);
        bmp.recycle();
        byte[] gray = new byte[w * h];
        for (int i = 0; i < pixels.length; i++) {
            int px = pixels[i];
            int r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            gray[i] = (byte) ((r * 299 + g * 587 + b * 114) / 1000);   // BT.601 luminance
        }
        // flip180 = TRUE always — the 241 builder runs DIRECTION 0 + in-layout 180,
        // so every band is pre-rotated 180 to read upright once the label is rotated.
        return Phomemo241Builder.packBits(gray, w, h, 128, true);
    }

    private static boolean containsCjk(String text) {
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            if ((cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xF900 && cp <= 0xFAFF)) {
                return true;
            }
        }
        return false;
    }
}
