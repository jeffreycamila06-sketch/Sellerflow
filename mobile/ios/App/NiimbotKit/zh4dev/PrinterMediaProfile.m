// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import "PrinterMediaProfile.h"
#import <math.h>

float JCResolveHorizontalCalibration(NSDictionary *layout, NSString *printerName, BOOL centeredFlow) {
    float explicitCorrection = [layout[@"horizontalCalibration"] floatValue];
    if (explicitCorrection != 0) return explicitCorrection;
    if (!centeredFlow || printerName.length == 0 ||
        (layout[@"usePrinterProfiles"] != nil && ![layout[@"usePrinterProfiles"] boolValue])) return 0;
    NSArray *profiles = [layout[@"printerProfiles"] isKindOfClass:[NSArray class]]
        ? layout[@"printerProfiles"] : @[];
    float padding = layout[@"padding"] != nil ? [layout[@"padding"] floatValue] : 2;
    NSString *orientation = layout[@"orientation"] ?: @"portrait";
    NSString *name = [printerName stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    for (NSDictionary *profile in profiles) {
        if (![profile isKindOfClass:[NSDictionary class]]) continue;
        NSString *profileName = profile[@"printerName"];
        if (![profileName isKindOfClass:[NSString class]] ||
            [profileName caseInsensitiveCompare:name] != NSOrderedSame ||
            ![profile[@"orientation"] isEqualToString:orientation]) continue;
        float correction = [profile[@"horizontalCorrection"] floatValue];
        if (fabsf([profile[@"width"] floatValue] - [layout[@"width"] floatValue]) < 0.01f &&
            fabsf([profile[@"height"] floatValue] - [layout[@"height"] floatValue]) < 0.01f &&
            isfinite(correction) && fabsf(correction) <= padding) return correction;
    }
    return 0;
}
