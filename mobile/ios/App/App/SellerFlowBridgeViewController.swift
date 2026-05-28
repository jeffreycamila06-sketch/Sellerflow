// SellerFlowBridgeViewController.swift
//
// Custom CAPBridgeViewController subclass.
//
// Responsibilities:
//   1. Register SellerFlowPrinterPlugin with the Capacitor bridge.
//   2. (DEBUG builds only) Show a floating "TEST PRINT" button that lets
//      us exercise the Swift printer code directly, without depending on
//      any TS/web change being deployed. This entire DEBUG block is
//      compiled out of Release builds and will be removed before merge.
//
// Storyboard (Main.storyboard) references this class via customClass.

import Capacitor
import UIKit

@objc(SellerFlowBridgeViewController)
public class SellerFlowBridgeViewController: CAPBridgeViewController {

    // Hold a strong reference so the DEBUG button can call back into the
    // same plugin instance Capacitor registers. In Release builds this is
    // only used during plugin registration.
    private let printerPlugin = SellerFlowPrinterPlugin()

    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(printerPlugin)
    }

    override public func viewDidLoad() {
        super.viewDidLoad()
        #if DEBUG
        installDebugTestPrintButton()
        #endif
    }

    // MARK: - DEBUG only: floating Test Print button

    #if DEBUG
    private weak var debugStatusLabel: UILabel?

    private func installDebugTestPrintButton() {
        // The button
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("🖨 DEBUG TEST PRINT", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        button.setTitleColor(.white, for: .normal)
        button.backgroundColor = UIColor(red: 0.85, green: 0.15, blue: 0.15, alpha: 0.92)
        button.layer.cornerRadius = 18
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.35
        button.layer.shadowOffset = CGSize(width: 0, height: 2)
        button.layer.shadowRadius = 6
        button.addTarget(self, action: #selector(debugTestPrintTapped), for: .touchUpInside)
        view.addSubview(button)

        // The status label (success / error feedback)
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.font = .systemFont(ofSize: 11, weight: .medium)
        label.textColor = .white
        label.textAlignment = .center
        label.backgroundColor = UIColor(white: 0, alpha: 0.78)
        label.layer.cornerRadius = 8
        label.layer.masksToBounds = true
        label.isHidden = true
        view.addSubview(label)
        self.debugStatusLabel = label

        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            button.heightAnchor.constraint(equalToConstant: 36),

            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            label.bottomAnchor.constraint(equalTo: button.topAnchor, constant: -8),
        ])

        view.bringSubviewToFront(button)
    }

    @objc private func debugTestPrintTapped() {
        let alert = UIAlertController(
            title: "DEBUG Test Print",
            message: "Send a test slip directly to your WiFi printer via Swift / Network.framework. Does not touch the web bridge.",
            preferredStyle: .alert
        )
        alert.addTextField { tf in
            tf.placeholder = "Printer IP"
            tf.text = "192.168.18.234"
            tf.keyboardType = .decimalPad
            tf.clearButtonMode = .whileEditing
        }
        alert.addTextField { tf in
            tf.placeholder = "Port"
            tf.text = "9100"
            tf.keyboardType = .numberPad
            tf.clearButtonMode = .whileEditing
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Print", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let host = alert.textFields?[0].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let port = Int(alert.textFields?[1].text ?? "") ?? 9100
            let message = "SellerFlow iOS Test Print"
            self.showDebugStatus("Connecting to \(host):\(port)...", isError: false)
            self.printerPlugin.debugTestPrint(host: host, port: port, message: message) { ok, info in
                self.showDebugStatus(ok ? "✅ \(info)" : "❌ \(info)", isError: !ok)
            }
        })
        present(alert, animated: true)
    }

    private func showDebugStatus(_ text: String, isError: Bool) {
        guard let label = debugStatusLabel else { return }
        label.text = "  \(text)  "
        label.backgroundColor = isError
            ? UIColor(red: 0.85, green: 0.15, blue: 0.15, alpha: 0.92)
            : UIColor(red: 0.10, green: 0.55, blue: 0.30, alpha: 0.92)
        label.isHidden = false
        // Auto-hide success after 6s; keep errors longer (12s) so user can read
        let hideDelay: TimeInterval = isError ? 12 : 6
        let snapshot = text
        DispatchQueue.main.asyncAfter(deadline: .now() + hideDelay) { [weak self] in
            if self?.debugStatusLabel?.text?.contains(snapshot) == true {
                self?.debugStatusLabel?.isHidden = true
            }
        }
    }
    #endif
}
