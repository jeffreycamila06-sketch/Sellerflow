// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>

@interface PrintLabelModel : NSObject

@property (nonatomic, strong) NSString *text;
@property (nonatomic, assign) double fontSize;
@property (nonatomic, strong) NSString *fontFamily;
@property (nonatomic, strong) NSString *fontStyle;
@property (nonatomic, strong) NSString *textAlignment;
@property (nonatomic, strong) NSString *sizingMode;
@property (nonatomic, assign) double minFontSize;
@property (nonatomic, assign) double maxFontSize;
@property (nonatomic, assign) NSInteger maxLines;
@property (nonatomic, assign) double fontSizeOffset;

- (NSArray<NSNumber *> *)fontStyles;
- (int)horizontalAlignmentWithFallback:(int)fallback;

- (instancetype)init;
- (instancetype)initWithText:(NSString *)text fontSize:(double)fontSize;
- (NSString *)toJson;
+ (PrintLabelModel *)fromJson:(NSString *)json;

@end
