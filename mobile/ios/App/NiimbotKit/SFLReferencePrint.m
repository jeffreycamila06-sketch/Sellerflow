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
    NSDictionary *element = @{
        @"type": @"image",
        @"frame": @{@"x": @0, @"y": @0, @"width": @(widthMm), @"height": @(heightMm)},
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
    NSLog(@"[Niimbot] reference printElements: 1 image element %gx%g mm, imageData=%lu chars, main=%d",
          widthMm, heightMm, (unsigned long)imageData.length, [NSThread isMainThread] ? 1 : 0);
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
