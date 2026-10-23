// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>
#import "FlutterShim.h"
#import "PrintUtility.h"
#import "JCAPI.h"
#import "PrinterConfigurationModel.h"
#import "LocalDataHelper.h"
#import "PrinterMediaProfile.h"
#import "InkBounds.h"
#import <CommonCrypto/CommonDigest.h>
#import "KeyConstant.h"
#import <math.h>
#import <float.h>

static const float JCLabelWidth = 50.0f;
static const float JCLabelHeight = 30.0f;
static const float JCTextHorizontalPadding = 2.0f;
static const int JCQrCodeType = 31;
static const NSTimeInterval JCPrintTimeoutSeconds = 30.0;
static NSString * const JCDefaultFontFile = @"ZT001.ttf";
static BOOL JCPrintInProgress = NO;

typedef BOOL (^JCDrawingBlock)(void);

static BOOL JCIsPrinterConnected(void) {
    int connectionState = [JCAPI isConnectingState];
    NSString *printerName = [JCAPI connectingPrinterName];
    return connectionState != 0 || printerName.length > 0;
}

@implementation PrintUtility

- (NSString *)printErrorMessage:(int)code {
    switch (code) {
        case 1: return @"Lid open";
        case 2: return @"Out of paper";
        case 3: return @"Not enough power";
        case 4: return @"Battery abnormality";
        case 5: return @"Manual stop";
        case 6: return @"Data error";
        case 7: return @"Temperature is too high";
        case 8: return @"Paper ejection abnormality";
        case 9: return @"Printer is busy";
        case 10: return @"No printhead detected";
        case 11: return @"Ambient temperature is too low";
        case 12: return @"The print head is not locked";
        case 13: return @"Ribbon not detected";
        case 14: return @"Mismatched ribbon";
        case 15: return @"Ribbon is used up";
        case 16: return @"Unsupported paper type";
        case 17: return @"Paper type setting failed";
        case 18: return @"Print mode setting failed";
        case 19: return @"Failed to set density";
        case 20: return @"Failed to write RFID";
        case 21: return @"Margin setting failed";
        case 22: return @"Communication error";
        case 23: return @"Printer disconnected";
        case 24: return @"Artboard parameter error";
        case 25: return @"Wrong rotation angle";
        case 26: return @"JSON parameter error";
        case 27: return @"Paper ejection abnormality (B3S)";
        case 28: return @"Check paper type";
        case 29: return @"RFID tag is not writable";
        case 30: return @"Density setting is not supported";
        case 31: return @"Unsupported print mode";
        default:
            return [NSString stringWithFormat:@"Unknown print error (%d)", code];
    }
}

- (void)printLabel:(NSArray<PrintLabelModel *> *)models
             layout:(NSDictionary *)layout
             result:(FlutterResult)result {
    [self startPrintWithDrawingBlock:^BOOL {
        return [self drawTextFlow:models layout:layout];
    } result:result];
}

- (void)printElements:(NSArray<NSDictionary *> *)elements
                layout:(NSDictionary *)layout
                result:(FlutterResult)result {
    BOOL textFlowOnly = YES;
    NSMutableArray<PrintLabelModel *> *textModels = [NSMutableArray array];
    for (NSDictionary *element in elements) {
        NSString *type = [element[@"type"] isKindOfClass:[NSString class]] ? element[@"type"] : @"text";
        if (![type isEqualToString:@"text"] || [element[@"frame"] isKindOfClass:[NSDictionary class]]) {
            textFlowOnly = NO;
            break;
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:element options:0 error:nil];
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        [textModels addObject:[PrintLabelModel fromJson:json]];
    }
    if (textFlowOnly) {
        [self printLabel:textModels layout:layout result:result];
        return;
    }
    [self startPrintWithDrawingBlock:^BOOL {
        return [self drawElements:elements layout:layout];
    } result:result];
}

- (void)generatePreview:(NSArray<NSDictionary *> *)elements
                  layout:(NSDictionary *)layout
                  result:(FlutterResult)result {
    @synchronized ([JCAPI class]) {
        if (JCPrintInProgress) {
            result([FlutterError errorWithCode:errorPrint message:@"Another print job is in progress" details:nil]);
            return;
        }
    }
    NSString *resourcePath = [NSBundle mainBundle].resourcePath;
    NSError *fontError = nil;
    [JCAPI initImageProcessing:resourcePath error:&fontError];
    if (fontError != nil) {
        result([FlutterError errorWithCode:errorPrint
                                   message:fontError.localizedDescription
                                   details:nil]);
        return;
    }
    @try {
        BOOL textFlowOnly = YES;
        NSMutableArray<PrintLabelModel *> *models = [NSMutableArray array];
        for (NSDictionary *element in elements) {
            NSString *type = [element[@"type"] isKindOfClass:[NSString class]] ? element[@"type"] : @"text";
            if (![type isEqualToString:@"text"] || [element[@"frame"] isKindOfClass:[NSDictionary class]]) {
                textFlowOnly = NO;
                break;
            }
            NSData *data = [NSJSONSerialization dataWithJSONObject:element options:0 error:nil];
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            [models addObject:[PrintLabelModel fromJson:json]];
        }
        if (textFlowOnly) {
            [self drawTextFlow:models layout:layout];
        } else {
            [self drawElements:elements layout:layout];
        }
        NSString *labelJson = [JCAPI GenerateLableJson];
        PrinterConfigurationModel *configuration = [[[LocalDataHelper alloc] init] getPrinterModel];
        NSError *previewError = nil;
        UIImage *image = [JCAPI generatePrintPreviewImage:labelJson
                                          displayMultiple:8.0f
                                            printMultiple:configuration.printMultiple
                                    printPreviewImageType:1
                                                    error:&previewError];
        NSData *png = image != nil ? UIImagePNGRepresentation(image) : nil;
        if (png.length == 0) {
            result([FlutterError errorWithCode:errorPrint
                                       message:previewError.localizedDescription ?: @"Unable to generate print preview"
                                       details:nil]);
            return;
        }
        result([FlutterStandardTypedData typedDataWithBytes:png]);
    } @catch (NSException *exception) {
        result([FlutterError errorWithCode:errorPrint
                                   message:exception.reason ?: @"Unable to generate print preview"
                                   details:nil]);
    }
}

- (BOOL)drawElements:(NSArray<NSDictionary *> *)elements layout:(NSDictionary *)layout {
    float physicalWidth = [layout[@"width"] floatValue] > 0 ? [layout[@"width"] floatValue] : JCLabelWidth;
    float physicalHeight = [layout[@"height"] floatValue] > 0 ? [layout[@"height"] floatValue] : JCLabelHeight;
    BOOL landscape = [layout[@"orientation"] isEqualToString:@"landscape"];
    float canvasWidth = landscape ? physicalHeight : physicalWidth;
    float canvasHeight = landscape ? physicalWidth : physicalHeight;
    float padding = layout[@"padding"] != nil ? MAX([layout[@"padding"] floatValue], 0.0f) : 2.0f;
    [JCAPI initDrawingBoard:canvasWidth withHeight:canvasHeight
        withHorizontalShift:0 withVerticalShift:0 rotate:(landscape ? 90 : 0)
        fontArray:@[JCDefaultFontFile]];
    BOOL success = YES;
    for (NSDictionary *element in elements) {
        NSString *type = element[@"type"] ?: @"text";
        NSDictionary *frame = [element[@"frame"] isKindOfClass:[NSDictionary class]] ? element[@"frame"] : nil;
        float x, y, width, height;
        if (frame != nil) {
            x = [frame[@"x"] floatValue];
            y = [frame[@"y"] floatValue];
            width = [frame[@"width"] floatValue];
            height = [frame[@"height"] floatValue];
        } else if ([type isEqualToString:@"qrCode"] || [type isEqualToString:@"barcode"]) {
            float availableWidth = MAX(canvasWidth - padding * 2.0f, 1.0f);
            float availableHeight = MAX(canvasHeight - padding * 2.0f, 1.0f);
            NSNumber *requestedWidth = [element[@"width"] isKindOfClass:[NSNumber class]] ? element[@"width"] : nil;
            NSNumber *requestedHeight = [element[@"height"] isKindOfClass:[NSNumber class]] ? element[@"height"] : nil;
            if ([type isEqualToString:@"qrCode"]) {
                float defaultSize = MIN(availableWidth, availableHeight) * 0.7f;
                width = requestedWidth != nil ? requestedWidth.floatValue
                    : (requestedHeight != nil ? requestedHeight.floatValue : defaultSize);
                height = requestedHeight != nil ? requestedHeight.floatValue : width;
            } else {
                width = requestedWidth != nil ? requestedWidth.floatValue : availableWidth;
                height = requestedHeight != nil ? requestedHeight.floatValue
                    : MIN(MAX(canvasHeight * 0.28f, 10.0f), availableHeight);
            }
            width = MIN(MAX(width, 1.0f), availableWidth);
            height = MIN(MAX(height, 1.0f), availableHeight);
            NSString *horizontal = element[@"horizontalAlignment"] ?: @"center";
            NSString *vertical = element[@"verticalAlignment"] ?: @"center";
            x = [horizontal isEqualToString:@"start"] ? padding
                : ([horizontal isEqualToString:@"end"] ? canvasWidth - padding - width
                    : (canvasWidth - width) / 2.0f);
            y = [vertical isEqualToString:@"start"] ? padding
                : ([vertical isEqualToString:@"end"] ? canvasHeight - padding - height
                    : (canvasHeight - height) / 2.0f);
        } else {
            @throw [NSException exceptionWithName:@"InvalidPrintElement"
                reason:[NSString stringWithFormat:@"An explicit frame is required for %@ elements", type]
                userInfo:nil];
        }
        int rotation = [element[@"rotation"] intValue];
        BOOL drawn = YES;
        if ([type isEqualToString:@"text"]) {
            NSData *data = [NSJSONSerialization dataWithJSONObject:element options:0 error:nil];
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            PrintLabelModel *model = [PrintLabelModel fromJson:json];
            float fontSize = [model.sizingMode isEqualToString:@"autoFit"]
                ? [self resolvedFontSize:model widthMm:width heightMm:height]
                : MAX(model.fontSize, 1.0f);
            drawn = [JCAPI drawLableText:x withY:y withWidth:width withHeight:height
                withString:model.text withFontFamily:model.fontFamily
                withFontSize:fontSize / 4.5f withRotate:rotation
                withTextAlignHorizonral:[model horizontalAlignmentWithFallback:1]
                withTextAlignVertical:1 withLineMode:6
                withLetterSpacing:0 withLineSpacing:1 withFontStyle:model.fontStyles];
        } else if ([type isEqualToString:@"qrCode"]) {
            drawn = [JCAPI drawLableQrCode:x withY:y withWidth:width withHeight:height
                withString:element[@"data"] ?: @"" withRotate:rotation
                withCodeType:[element[@"codeType"] intValue] ?: 31];
        } else if ([type isEqualToString:@"barcode"]) {
            drawn = [JCAPI drawLableBarCode:x withY:y withWidth:width withHeight:height
                withString:element[@"data"] ?: @""
                withFontSize:[element[@"fontSize"] floatValue]
                withRotate:rotation withCodeType:[element[@"barcodeType"] intValue]
                withTextHeight:[element[@"textHeight"] floatValue]
                withTextPosition:[element[@"textPosition"] intValue]];
        } else if ([type isEqualToString:@"line"]) {
            NSArray *dash = [element[@"dashWidth"] isKindOfClass:[NSArray class]]
                ? element[@"dashWidth"] : @[@1, @1];
            drawn = [JCAPI DrawLableLine:x withY:y withWidth:width withHeight:height
                withRotate:rotation withLineType:MAX([element[@"lineType"] intValue], 1)
                withDashWidth:dash];
        } else if ([type isEqualToString:@"image"]) {
            drawn = [JCAPI DrawLableImage:x withY:y withWidth:width withHeight:height
                withImageData:element[@"imageData"] ?: @"" withRotate:rotation
                withImageProcessingType:MAX([element[@"processingType"] intValue], 1)
                withImageProcessingValue:[element[@"threshold"] floatValue]];
        } else {
            @throw [NSException exceptionWithName:@"UnsupportedPrintElement"
                reason:[NSString stringWithFormat:@"Unsupported print element: %@", type]
                userInfo:nil];
        }
        success = success && drawn;
    }
    return success;
}

- (BOOL)drawTextFlow:(NSArray<PrintLabelModel *> *)models layout:(NSDictionary *)layout {
    NSTimeInterval started = [NSDate timeIntervalSinceReferenceDate];
    static NSCache<NSString *, NSValue *> *cache;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ cache = [[NSCache alloc] init]; cache.countLimit = 32; });
    PrinterConfigurationModel *configuration = [[[LocalDataHelper alloc] init] getPrinterModel];
    NSMutableArray *textPayload = [NSMutableArray array];
    for (PrintLabelModel *model in models) {
        [textPayload addObject:[NSJSONSerialization JSONObjectWithData:
            [[model toJson] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] ?: @{}];
    }
    NSData *payload = [NSJSONSerialization dataWithJSONObject:
        @{@"texts": textPayload, @"layout": layout, @"printMultiple": @(configuration.printMultiple)}
        options:NSJSONWritingSortedKeys error:nil];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(payload.bytes, (CC_LONG)payload.length, digest);
    NSMutableString *key = [NSMutableString string];
    for (NSUInteger i = 0; i < sizeof(digest); i++) [key appendFormat:@"%02x", digest[i]];
    BOOL landscape = [layout[@"orientation"] isEqualToString:@"landscape"];
    float width = [layout[@"width"] floatValue] > 0 ? [layout[@"width"] floatValue] : JCLabelWidth;
    float height = [layout[@"height"] floatValue] > 0 ? [layout[@"height"] floatValue] : JCLabelHeight;
    CGSize canvas = CGSizeMake(landscape ? height : width, landscape ? width : height);
    float padding = layout[@"padding"] != nil ? [layout[@"padding"] floatValue] : 2;
    int fallback = [layout[@"horizontalAlignment"] isEqualToString:@"start"] ? 0
        : ([layout[@"horizontalAlignment"] isEqualToString:@"end"] ? 2 : 1);
    BOOL centeredFlow = YES;
    for (PrintLabelModel *model in models) {
        if ([model horizontalAlignmentWithFallback:fallback] != 1) centeredFlow = NO;
    }
    NSValue *cached = [cache objectForKey:key];
    CGPoint correction = cached != nil ? cached.CGPointValue : CGPointZero;
    if (cached == nil) {
        [self drawTextFlowPass:models layout:layout rotation:0 correction:CGPointZero];
        @try {
            NSString *json = [JCAPI GenerateLableJson];
            NSError *error = nil;
            UIImage *preview = [JCAPI generatePrintPreviewImage:json displayMultiple:8.0f
                printMultiple:configuration.printMultiple printPreviewImageType:1 error:&error];
            CGImageRef image = preview.CGImage;
            if (image != nil) {
                size_t w = CGImageGetWidth(image), h = CGImageGetHeight(image);
                NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
                CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
                CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, w, h, 8, w * 4,
                    colorSpace, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
                CGColorSpaceRelease(colorSpace);
                if (context != NULL) {
                    CGContextDrawImage(context, CGRectMake(0, 0, w, h), image);
                    CGContextRelease(context);
                    JCInkCorrection measured = JCMeasureInkBounds(pixels.bytes, w, h,
                        canvas.width, canvas.height, padding, centeredFlow,
                        [layout[@"verticalAlignment"] ?: @"center" isEqualToString:@"center"]);
                    correction = CGPointMake(measured.x, measured.y);
                    if (measured.hasInk) [cache setObject:[NSValue valueWithCGPoint:correction] forKey:key];
                }
            }
        } @catch (NSException *exception) {
            NSLog(@"[Niimbot] Unable to measure ink bounds: %@", exception.reason);
        }
    }
    NSString *name = [JCAPI connectingPrinterName];
    if (name.length == 0) name = [[[LocalDataHelper alloc] init] getPrinterName];
    correction.x += JCResolveHorizontalCalibration(layout, name, centeredFlow);
    BOOL drawn = [self drawTextFlowPass:models layout:layout rotation:(landscape ? 90 : 0)
                            correction:correction];
    NSLog(@"[Niimbot] Text render cacheHit=%@, elapsedMs=%.2f",
          cached != nil ? @"YES" : @"NO", ([NSDate timeIntervalSinceReferenceDate] - started) * 1000);
    return drawn;
}

- (BOOL)drawTextFlowPass:(NSArray<PrintLabelModel *> *)models layout:(NSDictionary *)layout
               rotation:(int)rotation correction:(CGPoint)correction {
    float physicalWidth = [layout[@"width"] floatValue] > 0 ? [layout[@"width"] floatValue] : JCLabelWidth;
    float physicalHeight = [layout[@"height"] floatValue] > 0 ? [layout[@"height"] floatValue] : JCLabelHeight;
    BOOL landscape = [layout[@"orientation"] isEqualToString:@"landscape"];
    float canvasWidth = landscape ? physicalHeight : physicalWidth;
    float canvasHeight = landscape ? physicalWidth : physicalHeight;
    float padding = layout[@"padding"] != nil ? MAX([layout[@"padding"] floatValue], 0.0f) : 2.0f;
    float availableWidth = MAX(canvasWidth - padding * 2.0f, 1.0f);
    float availableHeight = MAX(canvasHeight - padding * 2.0f, 1.0f);
    float wrapWidth = MAX(availableWidth - 2.0f, 1.0f);
    float textSpacing = layout[@"textSpacing"] != nil
        ? MAX([layout[@"textSpacing"] floatValue], 0.0f) : 0.0f;
    float totalSpacing = textSpacing * MAX((NSInteger)models.count - 1, 0);
    float textAvailableHeight = availableHeight - totalSpacing;
    if (textAvailableHeight <= 0.0f) {
        @throw [NSException exceptionWithName:@"InvalidTextSpacing"
            reason:@"Text spacing exceeds the available label height" userInfo:nil];
    }
    [JCAPI initDrawingBoard:canvasWidth withHeight:canvasHeight withHorizontalShift:0
        withVerticalShift:0 rotate:rotation fontArray:@[JCDefaultFontFile]];
    float base = [self resolvedSharedAutoFontSize:models
                                          widthMm:wrapWidth
                                         heightMm:textAvailableHeight];
    NSMutableArray<NSNumber *> *sizes = [NSMutableArray array];
    NSMutableArray<NSNumber *> *heights = [NSMutableArray array];
    NSMutableArray<NSString *> *wrappedTexts = [NSMutableArray array];
    float contentHeight = totalSpacing;
    for (PrintLabelModel *model in models) {
        float size = [model.sizingMode isEqualToString:@"autoFit"]
            ? base + model.fontSizeOffset : MAX(model.fontSize, 1.0f);
        NSString *wrappedText = [self wrappedTextForModel:model
                                                 fontSize:size
                                                  widthMm:wrapWidth];
        NSInteger lines = [[wrappedText
            componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]] count];
        float height = MAX(size / 4.5f * 1.35f * lines, 2.0f);
        [sizes addObject:@(size)];
        [heights addObject:@(height)];
        [wrappedTexts addObject:wrappedText];
        contentHeight += height;
    }
    NSString *verticalAlignment = layout[@"verticalAlignment"] ?: @"center";
    float y;
    if ([verticalAlignment isEqualToString:@"start"]) {
        y = padding;
    } else if ([verticalAlignment isEqualToString:@"end"]) {
        y = canvasHeight - padding - contentHeight;
    } else {
        y = (canvasHeight - contentHeight) / 2.0f;
    }
    y += correction.y;
    int horizontalAlignment = [layout[@"horizontalAlignment"] isEqualToString:@"start"]
        ? 0 : ([layout[@"horizontalAlignment"] isEqualToString:@"end"] ? 2 : 1);
    BOOL success = YES;
    for (NSInteger index = 0; index < models.count; index++) {
        PrintLabelModel *model = models[index];
        float size = sizes[index].floatValue;
        float height = heights[index].floatValue;
        int textAlignment = [model horizontalAlignmentWithFallback:horizontalAlignment];
        BOOL drawn = [JCAPI drawLableText:padding + correction.x withY:y withWidth:availableWidth withHeight:height
            withString:wrappedTexts[index] withFontFamily:model.fontFamily withFontSize:size / 4.5f
            withRotate:0 withTextAlignHorizonral:textAlignment withTextAlignVertical:1
            withLineMode:6 withLetterSpacing:0 withLineSpacing:1 withFontStyle:model.fontStyles];
        success = success && drawn;
        y += height;
        if (index < models.count - 1) y += textSpacing;
    }
    return success;
}

- (float)resolvedFontSize:(PrintLabelModel *)model widthMm:(float)width heightMm:(float)height {
    float candidate = model.maxFontSize;
    while (candidate > model.minFontSize) {
        NSInteger lines = [self estimatedLineCount:model fontSize:candidate widthMm:width];
        if (lines <= model.maxLines &&
            [self wrappedTextFitsWidth:model.text fontSize:candidate widthMm:width] &&
            candidate / 4.5f * 1.35f * lines <= height) return candidate;
        candidate -= 0.5f;
    }
    return model.minFontSize;
}

- (float)resolvedSharedAutoFontSize:(NSArray<PrintLabelModel *> *)models
                            widthMm:(float)widthMm
                           heightMm:(float)heightMm {
    float minimumBase = 1.0f;
    float maximumBase = FLT_MAX;
    BOOL hasAutoFit = NO;
    for (PrintLabelModel *model in models) {
        if (![model.sizingMode isEqualToString:@"autoFit"]) continue;
        hasAutoFit = YES;
        minimumBase = MAX(minimumBase, model.minFontSize - model.fontSizeOffset);
        maximumBase = MIN(maximumBase, model.maxFontSize - model.fontSizeOffset);
    }
    if (!hasAutoFit) return 0.0f;
    if (maximumBase < minimumBase) maximumBase = minimumBase;

    float candidate = maximumBase;
    while (candidate > minimumBase &&
           ![self allAutoTextFits:models
                     baseFontSize:candidate
                          widthMm:widthMm
                         heightMm:heightMm]) {
        candidate -= 0.5f;
    }
    if (![self allAutoTextFits:models
                  baseFontSize:minimumBase
                       widthMm:widthMm
                      heightMm:heightMm]) {
        @throw [NSException
            exceptionWithName:@"NiimbotTextDoesNotFit"
                       reason:@"Text does not fit within the label at the minimum font size"
                     userInfo:nil];
    }
    return MAX(candidate, minimumBase);
}

- (BOOL)allAutoTextFits:(NSArray<PrintLabelModel *> *)models
           baseFontSize:(float)baseFontSize
                widthMm:(float)widthMm
               heightMm:(float)heightMm {
    float totalHeight = 0.0f;
    for (PrintLabelModel *model in models) {
        BOOL autoFit = [model.sizingMode isEqualToString:@"autoFit"];
        float fontSize = autoFit
            ? baseFontSize + model.fontSizeOffset
            : MAX(model.fontSize, 1.0f);
        NSInteger lines = [self estimatedLineCount:model
                                          fontSize:fontSize
                                           widthMm:widthMm];
        if ((autoFit &&
             (fontSize < model.minFontSize || fontSize > model.maxFontSize)) ||
            lines > MAX(model.maxLines, 1) ||
            ![self wrappedTextFitsWidth:model.text
                               fontSize:fontSize
                                widthMm:widthMm]) {
            return NO;
        }
        totalHeight += MAX(fontSize / 4.5f * 1.35f * lines, 2.0f);
    }
    return totalHeight <= heightMm;
}

- (NSInteger)estimatedLineCount:(PrintLabelModel *)model
                       fontSize:(float)fontSize
                        widthMm:(float)widthMm {
    return [[self wrappedLinesForText:model.text
                             fontSize:fontSize
                              widthMm:widthMm] count];
}

- (NSArray<NSString *> *)wrappedLinesForText:(NSString *)text
                                    fontSize:(float)fontSize
                                     widthMm:(float)widthMm {
    NSString *normalized = [(text ?: @"") stringByReplacingOccurrencesOfString:@"\r\n"
                                                                      withString:@"\n"];
    normalized = [normalized stringByReplacingOccurrencesOfString:@"\r" withString:@"\n"];
    NSArray<NSString *> *paragraphs = [normalized componentsSeparatedByString:@"\n"];
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    NSCharacterSet *whitespace = [NSCharacterSet whitespaceCharacterSet];
    for (NSString *paragraph in paragraphs) {
        NSString *trimmed = [paragraph stringByTrimmingCharactersInSet:whitespace];
        if (trimmed.length == 0) {
            [lines addObject:@""];
            continue;
        }
        NSMutableArray<NSString *> *words = [NSMutableArray array];
        for (NSString *word in [trimmed componentsSeparatedByCharactersInSet:whitespace]) {
            if (word.length > 0) [words addObject:word];
        }
        NSString *current = @"";
        for (NSString *word in words) {
            NSString *candidate = current.length == 0
                ? word
                : [NSString stringWithFormat:@"%@ %@", current, word];
            if (current.length == 0 ||
                [self estimatedTextWidth:candidate fontSize:fontSize] <= widthMm) {
                current = candidate;
            } else {
                [lines addObject:current];
                current = word;
            }
        }
        if (current.length > 0) [lines addObject:current];
    }
    return lines.count > 0 ? lines : @[@""];
}

- (NSString *)wrappedTextForModel:(PrintLabelModel *)model
                         fontSize:(float)fontSize
                          widthMm:(float)widthMm {
    return [[self wrappedLinesForText:model.text fontSize:fontSize widthMm:widthMm]
        componentsJoinedByString:@"\n"];
}

- (BOOL)wrappedTextFitsWidth:(NSString *)text
                    fontSize:(float)fontSize
                     widthMm:(float)widthMm {
    for (NSString *line in [self wrappedLinesForText:text
                                           fontSize:fontSize
                                            widthMm:widthMm]) {
        if ([self estimatedTextWidth:line fontSize:fontSize] > widthMm) return NO;
    }
    return YES;
}

- (float)estimatedTextWidth:(NSString *)text fontSize:(float)fontSize {
    float fontMm = fontSize / 4.5f;
    __block double weightedCharacters = 0.0;
    [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                             options:NSStringEnumerationByComposedCharacterSequences
                          usingBlock:^(NSString *substring, NSRange substringRange,
                                       NSRange enclosingRange, BOOL *stop) {
        unichar character = [substring characterAtIndex:0];
        weightedCharacters += character > 0x7f ? 1.0 : 0.58;
    }];
    return weightedCharacters * fontMm;
}

- (void)printQrCode:(PrintQrCodeModel *)qrCode result:(FlutterResult)result {
    [self startPrintWithDrawingBlock:^BOOL {
        float size = (float)qrCode.size;
        float x = (JCLabelWidth - size) / 2.0f;
        float y = (JCLabelHeight - size) / 2.0f;
        [JCAPI initDrawingBoard:JCLabelWidth
                     withHeight:JCLabelHeight
            withHorizontalShift:0
              withVerticalShift:0
                         rotate:0
                      fontArray:@[JCDefaultFontFile]];
        return [JCAPI drawLableQrCode:x
                                withY:y
                            withWidth:size
                           withHeight:size
                           withString:qrCode.data
                           withRotate:0
                         withCodeType:JCQrCodeType];
    } result:result];
}

- (void)startPrintWithDrawingBlock:(JCDrawingBlock)drawingBlock
                             result:(FlutterResult)result {
    if (!JCIsPrinterConnected()) {
        result([FlutterError errorWithCode:errorPrint
                                   message:@"Printer not connected"
                                   details:nil]);
        return;
    }
    @synchronized ([JCAPI class]) {
        if (JCPrintInProgress) {
            result([FlutterError errorWithCode:errorPrint
                                       message:@"Another print job is in progress"
                                       details:nil]);
            return;
        }
        JCPrintInProgress = YES;
    }

    __block BOOL completed = NO;
    void (^complete)(BOOL, NSString *) = ^(BOOL success, NSString *message) {
        @synchronized ([JCAPI class]) {
            if (completed) {
                return;
            }
            completed = YES;
            JCPrintInProgress = NO;
        }
        if (success) {
            result(@(YES));
        } else {
            result([FlutterError errorWithCode:errorPrint
                                       message:message ?: @"Print failed"
                                       details:nil]);
        }
    };

    dispatch_after(
        dispatch_time(
            DISPATCH_TIME_NOW,
            (int64_t)(JCPrintTimeoutSeconds * NSEC_PER_SEC)
        ),
        dispatch_get_main_queue(),
        ^{
            complete(NO, @"Print timed out. Check the printer connection and try again");
        }
    );

    // Follow SDKDemoOC v4.1.1: FONT.json and its font files are copied into
    // the app resources, then image processing is initialized from the main
    // bundle resource directory.
    NSString *resourcePath = [NSBundle mainBundle].resourcePath;
    NSString *fontManifestPath = [[NSBundle mainBundle]
        pathForResource:@"FONT"
                 ofType:@"json"];
    NSString *defaultFontPath = [[NSBundle mainBundle]
        pathForResource:@"ZT001"
                 ofType:@"ttf"];
    if (resourcePath.length == 0 ||
        fontManifestPath.length == 0 ||
        defaultFontPath.length == 0) {
        complete(NO, @"Niimbot font resource is missing");
        return;
    }
    NSError *fontError = nil;
    [JCAPI initImageProcessing:resourcePath error:&fontError];
    if (fontError != nil) {
        complete(NO, fontError.localizedDescription ?: @"Unable to initialize label renderer");
        return;
    }
    [JCAPI setPrintWithCache:YES];

    // SDKDemoOC renders the drawing board and generates its JSON before
    // starting the physical print job. Rendering inside startJob's callback
    // can make drawLableText return NO on iOS even though font setup succeeds.
    NSString *labelJson = nil;
    @try {
        // SDKDemoOC logs individual draw return values but still calls
        // GenerateLableJson. Some JCAPI versions report NO even when the
        // drawing command was accepted, so the generated JSON is the reliable
        // success signal here.
        BOOL drawingReportedSuccess = drawingBlock();
        NSLog(@"[Niimbot] drawing reported success=%@",
              drawingReportedSuccess ? @"YES" : @"NO");
        labelJson = [JCAPI GenerateLableJson];
    } @catch (NSException *exception) {
        complete(NO, exception.reason ?: @"Unable to render label content");
        return;
    }
    if (labelJson.length == 0) {
        complete(NO, @"Unable to generate label data");
        return;
    }

    [JCAPI getPrintingErrorInfo:^(NSString *printInfo) {
        complete(NO, [self printErrorMessage:printInfo.intValue]);
    }];
    [JCAPI getPrintingCountInfo:^(NSDictionary *printInfo) {
        if ([printInfo[@"totalCount"] integerValue] == 1) {
            [JCAPI endPrint:^(BOOL success) {
                complete(success, @"End printing failed");
            }];
        }
    }];

    PrinterConfigurationModel *configuration =
        [[[LocalDataHelper alloc] init] getPrinterModel];
    [JCAPI setTotalQuantityOfPrints:1];
    [JCAPI startJob:configuration.printDensity
     withPaperStyle:configuration.printModel
     withCompletion:^(BOOL success) {
        if (!success) {
            complete(NO, @"Unable to start print job");
            return;
        }
        [JCAPI commit:labelJson
          withOnePageNumbers:1
          withComplete:^(BOOL committed) {
            if (!committed) {
                complete(NO, @"Unable to send print data");
            }
        }];
    }];
}

@end
