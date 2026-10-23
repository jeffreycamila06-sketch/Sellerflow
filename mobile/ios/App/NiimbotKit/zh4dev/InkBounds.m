// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import "InkBounds.h"

JCInkCorrection JCMeasureInkBounds(const unsigned char *rgba, size_t width, size_t height,
    float canvasWidth, float canvasHeight, float padding, BOOL centerX, BOOL centerY) {
    JCInkCorrection result = {NO, 0, 0};
    if (rgba == NULL || width == 0 || height == 0) return result;
    NSInteger minX = width, minY = height, maxX = -1, maxY = -1;
    for (size_t y = 0; y < height; y++) {
        for (size_t x = 0; x < width; x++) {
            const unsigned char *pixel = rgba + (y * width + x) * 4;
            if (pixel[3] < 128 || pixel[0] + pixel[1] + pixel[2] >= 384) continue;
            minX = MIN(minX, (NSInteger)x); maxX = MAX(maxX, (NSInteger)x);
            minY = MIN(minY, (NSInteger)y); maxY = MAX(maxY, (NSInteger)y);
        }
    }
    if (maxX < minX) return result;
    result.hasInk = YES;
    if (centerX) result.x = MAX(-padding, MIN(padding,
        ((double)width - (minX + maxX + 1)) * canvasWidth / (2.0 * width)));
    if (centerY) result.y = ((double)height - (minY + maxY + 1)) * canvasHeight / (2.0 * height);
    return result;
}
