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

    // ── P3 bold tuning (finalized by the BOLD SAMPLER print — see the plugin's
    // BOLD_SAMPLER_MODE; these defaults are sampler row 4: stroke 1.5, thr 160) ──
    // BOLD_STROKE_DOTS widens every glyph stroke (FILL_AND_STROKE) in printer dots;
    // BOLD_THRESHOLD raises the gray→black cutoff so anti-aliased edge pixels
    // print (thermal dots fill fuller = heavier stroke). Regular threshold stays
    // the P3-pre value 128.
    static final float BOLD_STROKE_DOTS = 1.5f;
    static final int BOLD_THRESHOLD = 160;
    static final int REGULAR_THRESHOLD = 128;

    @Override
    public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxWidthDots) {
        return render(text, xMul, yMul, maxWidthDots, false);
    }

    /** P3 bold-aware entry — the builder's Emit calls this. */
    @Override
    public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxWidthDots, boolean bold) {
        return renderCore(text, xMul, yMul, maxWidthDots, bold,
                bold ? BOLD_STROKE_DOTS : 0f, bold ? BOLD_THRESHOLD : REGULAR_THRESHOLD);
    }

    /**
     * BOLD SAMPLER hook: same pipeline with EXPLICIT stroke/threshold so the
     * sampler print can lay out candidate weights side by side (always bold
     * typeface). Not used by production printing.
     */
    Phomemo241Builder.Band renderTuning(String text, double mul, int maxWidthDots, float strokeDots, int threshold) {
        return renderCore(text, mul, mul, maxWidthDots, true, strokeDots, threshold);
    }

    private Phomemo241Builder.Band renderCore(String text, double xMul, double yMul, int maxWidthDots, boolean bold, float strokeDots, int threshold) {
        if (text == null || text.isEmpty() || xMul <= 0 || yMul <= 0 || maxWidthDots <= 0) return null;

        // Height in PIXELS from the EXACT decimal (24 x yMul), so every 0.1 step of
        // the seller size adjuster changes the rendered glyph (BUG 3) — a
        // rotation-180 TEXT multiplier the 241 ignores, a pixel dimension it can't.
        int outH = Math.max(1, Math.round((float) (BASE_CELL * yMul)));
        boolean isCjk = containsCjk(text);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        // P3 bold: widen every stroke (FILL_AND_STROKE) — the third weight lever
        // besides the bold typeface and the pack threshold.
        if (strokeDots > 0f) {
            paint.setStyle(Paint.Style.FILL_AND_STROKE);
            paint.setStrokeWidth(strokeDots);
        }

        // P2 FITTING (measureText-based, proportional): a run that is too wide for
        // maxWidthDots is NEVER horizontally squished (that produced the thin,
        // rejected strokes). Instead the whole glyph size steps DOWN proportionally
        // — factors 1.0 → 0.85 → 0.70 — and only if it still doesn't fit at 0.70 is
        // the STRING truncated (measure-loop on the actual text, so mixed CJK+ASCII
        // like "陳小美 Anna x2" is measured correctly, not cell-estimated).
        final double[] FIT_STEPS = {1.0, 0.85, 0.70};

        Bitmap bmp;
        int outW;
        if (isCjk) {
            // CJK — system default typeface resolves to Noto CJK on minSdk 24
            // (Traditional-correct). Sized at outH x 0.82 x fit-step; width natural.
            paint.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            double fit = FIT_STEPS[FIT_STEPS.length - 1];
            for (double f : FIT_STEPS) {
                paint.setTextSize((float) (outH * 0.82 * f));
                if (paint.measureText(text) <= maxWidthDots) { fit = f; break; }
            }
            paint.setTextSize((float) (outH * 0.82 * fit));
            String run = text;
            while (run.length() > 1 && paint.measureText(run) > maxWidthDots) {
                run = run.substring(0, run.length() - 1);   // last resort: truncate at 0.70
            }
            float measured = paint.measureText(run);
            int w = Math.min((int) Math.ceil(measured), maxWidthDots);
            if (w <= 0) return null;
            outW = w;
            bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawColor(Color.WHITE);
            Paint.FontMetrics fm = paint.getFontMetrics();
            float textH = fm.descent - fm.ascent;
            float top = Math.max(0f, (outH - textH) / 2f);
            canvas.drawText(run, 0f, top - fm.ascent, paint);   // baseline placed so the run is vertically centered
        } else {
            // ASCII/Latin — monospace bold (closest to the TSPL ROM look), sized so
            // the FULL glyph (ascender-top DOWN TO descender-bottom) fits the base
            // cell, then STRETCH by (xMul, yMul) so the letter itself grows. Fitting
            // the whole ascent+descent extent (not just cap height) keeps the "y" in
            // "Buyer" and g/p/q/j from clipping at the bottom at every band scale.
            // P2: an over-wide run steps the WHOLE stretch down proportionally (both
            // axes — sharp shrink), then truncates; never a one-axis squish.
            paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
            paint.setTextSize(100f);
            Paint.FontMetrics ref = paint.getFontMetrics();
            float extent = Math.max(0.5f, ref.descent - ref.ascent);   // ascent is negative
            paint.setTextSize(100f * (BASE_CELL / extent));
            Paint.FontMetrics fm = paint.getFontMetrics();
            float measured = paint.measureText(text);
            if (measured < 1f) return null;
            double fit = FIT_STEPS[FIT_STEPS.length - 1];
            for (double f : FIT_STEPS) {
                if (measured * xMul * f <= maxWidthDots) { fit = f; break; }
            }
            String run = text;
            while (run.length() > 1 && paint.measureText(run) * xMul * fit > maxWidthDots) {
                run = run.substring(0, run.length() - 1);   // last resort: truncate at 0.70
            }
            measured = paint.measureText(run);
            if (measured < 1f) return null;
            outW = Math.min((int) Math.ceil(measured * xMul * fit), maxWidthDots);
            if (outW <= 0) return null;
            bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawColor(Color.WHITE);
            canvas.save();
            // Proportional: BOTH axes carry the same fit factor — the glyph shrinks
            // as a shape, it is never squeezed on one axis.
            canvas.scale((float) (xMul * fit), (float) (yMul * fit));
            canvas.drawText(run, 0f, -fm.ascent, paint);   // ascent-top → 0, descender-bottom → BASE_CELL
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
        return Phomemo241Builder.packBits(gray, w, h, threshold, true);
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
