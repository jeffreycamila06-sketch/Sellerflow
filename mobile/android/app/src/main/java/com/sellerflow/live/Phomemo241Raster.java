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

    // Pack threshold for NON-primary CJK bands only (scaled CJK store name / CJK
    // price item — the pre-P3 behavior, untouched). Everything else packs at the
    // P3.7 one-weight ROM_BAND_THRESHOLD (160): every non-CJK band regardless of
    // the bold flag, and CJK primaries (the approved P3 row-C tuning). The
    // selection lives in the PURE Phomemo241Builder.boldStrokeFor/
    // boldThresholdFor / ROM_BAND_THRESHOLD (JVM-pinned); this class consumes it.
    static final int REGULAR_THRESHOLD = 128;

    @Override
    public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxWidthDots) {
        return render(text, xMul, yMul, maxWidthDots, false);
    }

    /** Bold-aware entry — the builder's Emit calls this. */
    @Override
    public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxWidthDots, boolean bold) {
        // P3.7 (Jeff's font-sampler verdict, 2026-07-18): every NON-CJK band —
        // bold-flagged or not — renders in the ROM-emulation style at the ONE
        // approved weight: regular face, zero stroke, ROM_BAND_THRESHOLD (160,
        // the Row-C/CJK weight). "bold" is a prominence/routing flag for ASCII
        // now (hierarchy = SIZE); stretched (buyer#/price) and non-stretched
        // (name/@user) ASCII bands therefore carry the SAME visual weight. CJK
        // keeps the approved P3 tuning: bold typeface + 160 when flagged,
        // default face + REGULAR_THRESHOLD otherwise.
        if (!containsCjk(text)) {
            return renderCore(text, xMul, yMul, maxWidthDots, false, 0f, Phomemo241Builder.ROM_BAND_THRESHOLD);
        }
        return renderCore(text, xMul, yMul, maxWidthDots, bold,
                bold ? Phomemo241Builder.boldStrokeFor(text) : 0f,
                bold ? Phomemo241Builder.boldThresholdFor(text) : REGULAR_THRESHOLD);
    }

    /**
     * BOLD SAMPLER hook: same pipeline with EXPLICIT stroke/threshold so the
     * sampler print can lay out candidate weights side by side. Not used by
     * production printing. (P3.7 note: the ASCII branch now always draws the
     * regular ROM face, so this diagnostic varies stroke/threshold only.)
     */
    Phomemo241Builder.Band renderTuning(String text, double mul, int maxWidthDots, float strokeDots, int threshold) {
        return renderCore(text, mul, mul, maxWidthDots, true, strokeDots, threshold);
    }

    /**
     * P3.7 ROM-EMULATION render (the AIMO "sexy" look): draw the run in REGULAR
     * weight (no bold face, no stroke unless a light one is asked for) at the base
     * cell height, at NATURAL 1x width with optional letter-spacing (the ROM cell's
     * built-in air between chars), then duplicate pixel COLUMNS xhStretch — exactly
     * what the AIMO firmware does for a TEXT x-multiplier. Thin strokes widen
     * geometrically; the letter never "fattens". Used by the FONT SAMPLER (and by
     * production once Jeff picks a row).
     *
     * @param cellH          glyph cell height in dots (32 = the AIMO font-4 cell)
     * @param hStretch       integer column-duplication factor (2 = the AIMO x2)
     * @param letterSpacingEm extra tracking in ems (0 = font natural)
     * @param strokeDots     0 = pure regular; small values = very light bolding
     */
    Phomemo241Builder.Band renderRom(String text, int cellH, int hStretch, float letterSpacingEm, float strokeDots, int threshold, int maxWidthDots) {
        if (text == null || text.isEmpty() || cellH <= 0 || hStretch < 1 || maxWidthDots <= 0) return null;
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.MONOSPACE);   // REGULAR weight — the thin-stroke base
        if (strokeDots > 0f) {
            paint.setStyle(Paint.Style.FILL_AND_STROKE);
            paint.setStrokeWidth(strokeDots);
        }
        if (letterSpacingEm > 0f) paint.setLetterSpacing(letterSpacingEm);
        // Size so the full ascent..descent extent fits the cell (same rule as the band path).
        paint.setTextSize(100f);
        Paint.FontMetrics ref = paint.getFontMetrics();
        float extent = Math.max(0.5f, ref.descent - ref.ascent);
        paint.setTextSize(100f * (cellH / extent));
        Paint.FontMetrics fm = paint.getFontMetrics();
        // Natural width at 1x; truncate (measure-loop) so the STRETCHED result fits.
        String run = text;
        while (run.length() > 1 && paint.measureText(run) * hStretch > maxWidthDots) {
            run = run.substring(0, run.length() - 1);
        }
        float measured = paint.measureText(run);
        if (measured < 1f) return null;
        int w1 = Math.max(1, (int) Math.ceil(measured));
        Bitmap bmp = Bitmap.createBitmap(w1, cellH, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);
        canvas.drawText(run, 0f, -fm.ascent, paint);
        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] pixels = new int[w * h];
        bmp.getPixels(pixels, 0, w, 0, 0, w, h);
        bmp.recycle();
        byte[] gray = new byte[w * h];
        for (int i = 0; i < pixels.length; i++) {
            int px = pixels[i];
            int r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            gray[i] = (byte) ((r * 299 + g * 587 + b * 114) / 1000);
        }
        // The ROM x-multiplier: pure column duplication (JVM-pinned in the builder);
        // the measure-loop above already guarantees w x hStretch <= maxWidthDots.
        byte[] stretched = Phomemo241Builder.stretchGrayH(gray, w, h, hStretch);
        if (stretched == null) return null;
        return Phomemo241Builder.packBits(stretched, w * hStretch, h, threshold, true);
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
        // Stroke widening (FILL_AND_STROKE) — P3.7: production always passes 0
        // (boldStrokeFor returns 0 for every script); only the retained
        // renderTuning sampler diagnostic can still exercise it.
        if (strokeDots > 0f) {
            paint.setStyle(Paint.Style.FILL_AND_STROKE);
            paint.setStrokeWidth(strokeDots);
        }

        // P2 FITTING (measureText-based, proportional): a run that is too wide for
        // maxWidthDots is NEVER horizontally squished (that produced the thin,
        // rejected strokes). Instead the whole glyph size steps DOWN proportionally
        // — 1.0 → 0.95 → 0.85 → 0.70 (P3.6 added the 0.95 rung: a 2% near-miss,
        // e.g. the 432-dot "Buyer #NN" vs the 424-dot 60x40 avail, now trims 5%
        // instead of dropping a full 15%) — and only if it still doesn't fit at
        // 0.70 is the STRING truncated (measure-loop on the actual text, so mixed
        // CJK+ASCII like "陳小美 Anna x2" is measured correctly, not cell-estimated).
        final double[] FIT_STEPS = {1.0, 0.95, 0.85, 0.70};

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
            // ASCII/Latin — P3.7 ROM-EMULATION, the production enlarged-ASCII style
            // (Jeff's font-sampler verdict: ROW 2's mechanism at ROW C's weight).
            // REGULAR monospace — no bold face; weight comes from the pack
            // threshold alone (render() injects ROM_BAND_THRESHOLD). The run is
            // drawn as a SHARP VECTOR at the smaller axis' target size, then the
            // larger axis is nearest-neighbor pixel-stretched to the full target
            // (Phomemo241Builder.stretchGrayNearest) — the AIMO firmware's own
            // TEXT-multiplier mechanism (column/row duplication), so the thin
            // regular strokes WIDEN geometrically instead of the letter fattening
            // ("payat na lumalapad", never "buntis"). Sizing fits the FULL
            // ascent..descent extent so descenders (the "y" in "Buyer", g/p/q/j)
            // never clip. P2 is unchanged: an over-wide run steps the WHOLE
            // target down proportionally (both axes — sharp shrink), then
            // truncates; never a one-axis squish.
            paint.setTypeface(Typeface.MONOSPACE);   // REGULAR — the thin-stroke base
            paint.setTextSize(100f);
            Paint.FontMetrics ref = paint.getFontMetrics();
            float extent = Math.max(0.5f, ref.descent - ref.ascent);   // ascent is negative
            paint.setTextSize(100f * (BASE_CELL / extent));
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
            // Vector-draw at the SMALLER axis' size (crisp glyph at its natural
            // aspect), then stretch the remainder by pixel duplication. xMul >=
            // yMul (buyer#/price/@user) → drawn at the height target, columns
            // stretched; yMul > xMul (tall regular bands) → drawn at the width
            // target, rows stretched. Equal muls (name) → pure vector, no stretch.
            double mDraw = Math.min(xMul, yMul) * fit;
            paint.setTextSize((float) (100f * (BASE_CELL * mDraw) / extent));
            Paint.FontMetrics fm = paint.getFontMetrics();
            int wDraw = Math.max(1, Math.min((int) Math.ceil(paint.measureText(run)), outW));
            int hDraw = Math.max(1, Math.min(outH, (int) Math.round(BASE_CELL * mDraw)));
            Bitmap draw = Bitmap.createBitmap(wDraw, hDraw, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(draw);
            canvas.drawColor(Color.WHITE);
            canvas.drawText(run, 0f, -fm.ascent, paint);   // ascent-top → 0, descender-bottom → cell
            int[] px = new int[wDraw * hDraw];
            draw.getPixels(px, 0, wDraw, 0, 0, wDraw, hDraw);
            draw.recycle();
            byte[] gray0 = new byte[wDraw * hDraw];
            for (int i = 0; i < px.length; i++) {
                int p = px[i];
                gray0[i] = (byte) ((((p >> 16) & 0xFF) * 299 + ((p >> 8) & 0xFF) * 587 + (p & 0xFF) * 114) / 1000);
            }
            // Stretch to the full glyph target; the band stays the reserved outH
            // cell (24 x yMul) — a stepped-down (fit<1) glyph is top-aligned with
            // white padding below, exactly the old geometry.
            int hGlyph = Math.min(outH, Math.max(hDraw, (int) Math.round(BASE_CELL * yMul * fit)));
            byte[] stretched = Phomemo241Builder.stretchGrayNearest(gray0, wDraw, hDraw, outW, hGlyph);
            if (stretched == null) return null;
            byte[] cell = stretched;
            if (hGlyph < outH) {
                cell = new byte[outW * outH];
                java.util.Arrays.fill(cell, (byte) 0xFF);
                System.arraycopy(stretched, 0, cell, 0, stretched.length);
            }
            return Phomemo241Builder.packBits(cell, outW, outH, threshold, true);
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
