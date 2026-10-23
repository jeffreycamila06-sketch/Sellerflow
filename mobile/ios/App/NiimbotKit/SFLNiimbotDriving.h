// SFLNiimbotDriving.h — the ONE Objective-C protocol between the app and NiimbotKit.framework.
//
// The app never links NiimbotKit: it dlopen()s the embedded framework at runtime (iOS 17.2+
// only), looks up the "NiimbotKitDriver" class by name and talks to it through this protocol.
// Both images compile this header; the Objective-C runtime matches protocols by name, so the
// app's cast to SFLNiimbotDriving succeeds against the framework's class.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// ok = the label printed (the SDK confirmed completion). code/message = seller-level failure
/// (NIIMBOT_NO_PAPER, NIIMBOT_COVER_OPEN, NIIMBOT_PAPER_TYPE, NIIMBOT_LOW_BATTERY, BT_NOT_FOUND,
/// BT_BUSY, BT_PRINT_FAILED, NIIMBOT_ERROR, NIIMBOT_UNAVAILABLE); empty code on success.
typedef void (^SFLNiimbotCompletion)(BOOL ok, NSString *code, NSString *message);

@protocol SFLNiimbotDriving <NSObject>

/// Print ONE label from a ready image file (24-bit BMP, black ink on white, built by the app from its 1-bit
/// sticker image). The SDK's DrawLableImage takes an image file's bytes, base64-encoded.
- (void)printLabelWithName:(NSString *)name
                       png:(NSData *)png
              labelWidthMm:(float)labelWidthMm
             labelHeightMm:(float)labelHeightMm
                completion:(SFLNiimbotCompletion)completion;

@end

NS_ASSUME_NONNULL_END
