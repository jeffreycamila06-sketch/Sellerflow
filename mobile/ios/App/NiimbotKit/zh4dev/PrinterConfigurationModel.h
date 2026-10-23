// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>

@interface PrinterConfigurationModel : NSObject

@property (nonatomic, assign) int printModel;
@property (nonatomic, assign) int printDensity;
@property (nonatomic, assign) float printMultiple;

- (instancetype)init;
- (instancetype)initWithPrintModel:(int)printModel printDensity:(int)printDensity printMultiple:(float)printMultiple;
- (NSString *)toJson;
+ (PrinterConfigurationModel *)fromJson:(NSString *)json;

@end
