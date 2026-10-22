// Ported VERBATIM from zh4dev/niimbot-printer (ios/Classes, package 0.3.2, commit 37b05b5) — MIT, see LICENSE in this folder.
// Only change: "#import <Flutter/Flutter.h>" → "FlutterShim.h" (this framework has no Flutter).
#import <Foundation/Foundation.h>

@interface KeyConstant : NSObject

extern NSString * const defaultFontName;
extern NSString * const connectionSuccess;
extern NSString * const connectionFailed;
extern NSString * const unsupportedModels;
extern NSString * const failedPairing;
extern NSString * const errorPrint;
extern NSString * const emptyText;
extern NSString * const failedDisconnect;

@end
