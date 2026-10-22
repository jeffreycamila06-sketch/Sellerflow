// FlutterShim.h — the three Flutter types the verbatim zh4dev PrintUtility.m uses
// (FlutterResult / FlutterError / FlutterStandardTypedData), so the reference print path
// compiles unchanged inside NiimbotKit.framework without Flutter. Behaviour matches the
// Flutter originals as far as PrintUtility uses them: result(@(YES)) on success, a
// FlutterError (code + message) on failure.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FlutterResult)(id _Nullable result);

@interface FlutterError : NSObject
@property (nonatomic, readonly) NSString *code;
@property (nonatomic, readonly, nullable) NSString *message;
@property (nonatomic, readonly, nullable) id details;
+ (instancetype)errorWithCode:(NSString *)code message:(nullable NSString *)message details:(nullable id)details;
@end

@interface FlutterStandardTypedData : NSObject
@property (nonatomic, readonly) NSData *data;
+ (instancetype)typedDataWithBytes:(NSData *)data;
@end

NS_ASSUME_NONNULL_END
