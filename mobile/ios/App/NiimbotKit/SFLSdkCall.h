// SFLSdkCall.h — runs a block of vendor-SDK (JCAPI) calls under Objective-C @try/@catch.
// Swift cannot catch NSException; without this an SDK "unrecognized selector" (seen on the
// B1 field test: +[JCAPI generateImagePreviewImage:error:] is declared in JCAPI.h but is NOT
// in this libJCAPI.a) takes the whole app down instead of becoming a logged NIIMBOT_ERROR.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs `block`. Returns nil when it completed, or "<exception name>: <reason>" when it threw.
FOUNDATION_EXPORT NSString * _Nullable SFLSdkCall(void (NS_NOESCAPE ^block)(void));

NS_ASSUME_NONNULL_END
