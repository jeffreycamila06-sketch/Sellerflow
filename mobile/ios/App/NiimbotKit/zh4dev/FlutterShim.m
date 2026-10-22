#import "FlutterShim.h"

@implementation FlutterError
+ (instancetype)errorWithCode:(NSString *)code message:(NSString *)message details:(id)details {
    FlutterError *e = [[FlutterError alloc] init];
    e->_code = code;
    e->_message = message;
    e->_details = details;
    return e;
}
@end

@implementation FlutterStandardTypedData
+ (instancetype)typedDataWithBytes:(NSData *)data {
    FlutterStandardTypedData *d = [[FlutterStandardTypedData alloc] init];
    d->_data = data;
    return d;
}
@end
