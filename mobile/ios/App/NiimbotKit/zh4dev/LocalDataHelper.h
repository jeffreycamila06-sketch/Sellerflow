// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>
#import "PrinterConfigurationModel.h"

@interface LocalDataHelper : NSObject

- (void)setPrinterModel:(NSString *)printerName;
- (PrinterConfigurationModel *)getPrinterModel;
- (NSString *)getPrinterName;

@end
