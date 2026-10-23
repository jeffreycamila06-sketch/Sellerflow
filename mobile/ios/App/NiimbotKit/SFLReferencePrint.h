// SFLReferencePrint.h — the ONE entry point the driver uses: it calls the verbatim zh4dev
// reference print path (zh4dev/PrintUtility.m + models, MIT) exactly the way the reference's
// Flutter plugin does — connect = PrintHelper onStartConnect (openPrinter + setPrinterModel),
// print = PrintHelper onStartPrint with ONE "image" element on the label. No other SDK call.
// Must be called on the MAIN thread (Flutter's method-channel handler runs there).
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^SFLReferencePrintCompletion)(BOOL ok, NSString *message);

@interface SFLReferencePrint : NSObject

/// = zh4dev PrintHelper onStartConnect: [JCAPI openPrinter:name completion:] then
/// LocalDataHelper setPrinterModel:name (density/paper profile for the name) on success.
+ (void)connectPrinterNamed:(NSString *)name completion:(void (^)(BOOL ok))completion;

/// = zh4dev PrintHelper onStartPrint with a single element
/// {type:"image", frame:{x:0,y:0,width:w,height:h}, imageData:<base64>, rotation:0,
///  processingType:1, threshold:127} and the Dart default NiimbotLabelLayout for w×h mm.
+ (void)printImageBase64:(NSString *)imageData widthMm:(float)widthMm heightMm:(float)heightMm completion:(SFLReferencePrintCompletion)completion;

@end

NS_ASSUME_NONNULL_END
