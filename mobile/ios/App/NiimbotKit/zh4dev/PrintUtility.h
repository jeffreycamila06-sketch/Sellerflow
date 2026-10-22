// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
                    #import <Foundation/Foundation.h>
#import "PrintLabelModel.h"
#import "PrintQrCodeModel.h"
#import "FlutterShim.h"

@interface PrintUtility : NSObject

- (void)printLabel:(NSArray<PrintLabelModel *> *)printLabelModels
             layout:(NSDictionary *)layout
             result:(FlutterResult)result;
- (void)printQrCode:(PrintQrCodeModel *)qrCode result:(FlutterResult)result;
- (void)printElements:(NSArray<NSDictionary *> *)elements
                layout:(NSDictionary *)layout
                result:(FlutterResult)result;
- (void)generatePreview:(NSArray<NSDictionary *> *)elements
                  layout:(NSDictionary *)layout
                  result:(FlutterResult)result;

@end
