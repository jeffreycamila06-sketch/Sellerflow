// SellerFlowBridgeViewController.swift
//
// Custom CAPBridgeViewController subclass. Sole responsibility:
// register SellerFlowPrinterPlugin with the Capacitor bridge so the
// JS-side `window.Capacitor.Plugins.SellerFlowPrinter` resolves.
//
// Storyboard (Main.storyboard) references this class via customClass.

import Capacitor
import UIKit

@objc(SellerFlowBridgeViewController)
public class SellerFlowBridgeViewController: CAPBridgeViewController {
    private let printerPlugin = SellerFlowPrinterPlugin()
    private let authPlugin = SellerFlowAuthPlugin()

    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(printerPlugin)
        bridge?.registerPluginInstance(authPlugin) // in-app Facebook sign-in sheet (SellerFlowAuthPlugin.swift)
    }
}
