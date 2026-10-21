// App-Bridging-Header.h — Objective-C headers visible to the Swift app.
//
// Niimbot vendor SDK (printer setup v2, Part 8 — NiimbotTransport.swift). The static
// libraries in App/Niimbot/ are arm64 DEVICE slices only, so the SDK is imported and
// linked for real devices only; the simulator (the XCTest gate) builds the stub transport.
#if !TARGET_OS_SIMULATOR
#import "Niimbot/JCAPI.h"
#endif
