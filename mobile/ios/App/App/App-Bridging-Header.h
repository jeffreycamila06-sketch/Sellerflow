// App-Bridging-Header.h — Objective-C headers visible to the Swift app.
//
// Niimbot (printer setup v2, Part 8): ONLY the protocol the app uses to talk to the embedded
// NiimbotKit.framework after dlopen (NiimbotTransport.swift). The vendor SDK header (JCAPI.h)
// and its libraries live inside the framework; the app never imports or links them.
#import "../NiimbotKit/SFLNiimbotDriving.h"
