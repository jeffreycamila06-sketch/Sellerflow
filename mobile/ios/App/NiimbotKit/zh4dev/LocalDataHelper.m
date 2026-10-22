// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import "LocalDataHelper.h"
#import "PrinterConfigurationModel.h"
#import "LocalDataConstant.h"

@implementation LocalDataHelper

- (void)setPrinterModel:(NSString *)printerName {
    NSUserDefaults *userDefaults = [NSUserDefaults standardUserDefaults];
    [userDefaults setObject:printerName forKey:@"connectedPrinterName"];
    PrinterConfigurationModel *model;

    if ([printerName rangeOfString:@"^(B32|Z401|B50|T6|T7|T8).*" options:NSRegularExpressionSearch].location != NSNotFound) {
        model = [[PrinterConfigurationModel alloc] initWithPrintModel:2 printDensity:8 printMultiple:11.81];
    } else {
        model = [[PrinterConfigurationModel alloc] initWithPrintModel:1 printDensity:3 printMultiple:8.0];
    }

    NSString *json = [model toJson];
    [userDefaults setObject:json forKey:printConfiguration];
    [userDefaults synchronize];
}

- (PrinterConfigurationModel *)getPrinterModel {
    NSUserDefaults *userDefaults = [NSUserDefaults standardUserDefaults];
    NSString *json = [userDefaults objectForKey:printConfiguration];
    PrinterConfigurationModel *model = [[PrinterConfigurationModel alloc] initWithPrintModel:1 printDensity:3 printMultiple:8.0];

    if (json) {
        model = [PrinterConfigurationModel fromJson:json];
    }

    return model;
}

- (NSString *)getPrinterName {
    return [[NSUserDefaults standardUserDefaults] stringForKey:@"connectedPrinterName"] ?: @"";
}

@end
