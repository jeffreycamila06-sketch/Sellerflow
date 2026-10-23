// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>

typedef struct { BOOL hasInk; float x; float y; } JCInkCorrection;
FOUNDATION_EXPORT JCInkCorrection JCMeasureInkBounds(const unsigned char *rgba,
    size_t width, size_t height, float canvasWidth, float canvasHeight,
    float padding, BOOL centerX, BOOL centerY);
