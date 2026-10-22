#import "SFLReferencePrint.h"
#import "JCAPI.h"
#import "PrintUtility.h"
#import "LocalDataHelper.h"
#import "FlutterShim.h"

@implementation SFLReferencePrint

// Verbatim shape of zh4dev PrintHelper.m onStartConnect (minus the Flutter argument parsing).
+ (void)connectPrinterNamed:(NSString *)name completion:(void (^)(BOOL ok))completion {
    __block BOOL completed = NO;
    [JCAPI openPrinter:name completion:^(BOOL isSuccess) {
        if (completed) {
            return;
        }
        completed = YES;
        if (isSuccess) {
            [[[LocalDataHelper alloc] init] setPrinterModel:name];
        }
        completion(isSuccess);
    }];
}

+ (void)printImageBase64:(NSString *)imageData widthMm:(float)widthMm heightMm:(float)heightMm completion:(SFLReferencePrintCompletion)completion {
    // NiimbotImageElement.toJson() + NiimbotLabelLayout() defaults, as the Dart side sends them.
    // FRAME: inset 1 mm on every side (48×28 on a 50×30 label). The reference's image
    // examples never draw full-bleed — README (2,2,20×20), example app (10,3,30×24) and
    // (5,3,40×24) — and the B1 field test's full-board frame (0,0,50×30) always came back
    // "drawing reported success=NO" + a blank label, the BMP/PNG having been decoded and
    // thresholded by the SDK first (its own log lines) = a bounds rejection after compose.
    const float inset = 1.0f;
    NSDictionary *frame = @{@"x": @(inset), @"y": @(inset), @"width": @(widthMm - 2 * inset), @"height": @(heightMm - 2 * inset)};
    NSDictionary *element = @{
        @"type": @"image",
        @"frame": frame,
        @"imageData": imageData,
        @"rotation": @0,
        @"processingType": @1,
        @"threshold": @127,
    };
    NSDictionary *layout = @{
        @"width": @(widthMm), @"height": @(heightMm),
        @"orientation": @"portrait",
        @"horizontalAlignment": @"center", @"verticalAlignment": @"center",
        @"padding": @2, @"textSpacing": @0, @"horizontalCalibration": @0,
        @"usePrinterProfiles": @YES, @"printerProfiles": @[],
    };
    NSLog(@"[Niimbot] reference printElements: 1 image element, label %gx%g mm, frame x=%@ y=%@ w=%@ h=%@ mm, imageData=%lu chars, main=%d",
          widthMm, heightMm, frame[@"x"], frame[@"y"], frame[@"width"], frame[@"height"], (unsigned long)imageData.length, [NSThread isMainThread] ? 1 : 0);
    [[[PrintUtility alloc] init] printElements:@[element] layout:layout result:^(id result) {
        if ([result isKindOfClass:[FlutterError class]]) {
            FlutterError *error = (FlutterError *)result;
            NSLog(@"[Niimbot] reference result: error code=%@ message=%@", error.code, error.message ?: @"");
            completion(NO, error.message ?: error.code);
        } else {
            NSLog(@"[Niimbot] reference result: %@", result);
            completion(YES, @"Sent to printer");
        }
    }];
}

@end
