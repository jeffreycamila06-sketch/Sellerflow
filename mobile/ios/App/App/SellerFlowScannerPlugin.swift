// SellerFlowScannerPlugin.swift
//
// Native "Scan sticker QR" (app build 15+). JS:
//   window.Capacitor.Plugins.SellerFlowScanner.scanStickerQr({ texts })
//   → { status: "read", text }                      a sticker QR, the text VERBATIM
//   → { status: "photo", data: <base64>, mime }      "Take a photo instead" → the phone's own
//                                                    Take photo / Choose from photos; the web reads
//                                                    it with today's readQrFromFile
//   → { status: "cancelled" } | { status: "busy" } | { status: "error", code }
//
// The screen (same look as Android): full-screen camera, a rounded square frame in the middle,
// ✕ top-left, flashlight top-right (hidden when there is no light), title + hint, and
// "Take a photo instead" at the bottom. Texts come from the web in the seller's language.
// Apple's own reader (AVFoundation AVCaptureMetadataOutput, QR only) — no package.
// The QR nearest the frame's centre is read only when it is clearly nearer than any other
// QR and won 2 frames in a row (QrCentrePick, mirror of src/lib/qrCentrePick.ts). Too close to
// call → "Point at one QR". A read = a short beep (follows the silent switch) + a haptic tap.
// Presented .overFullScreen so the web page stays on screen under it (a live seller's
// comments, wake lock and timers keep running).
//
// Separate from SellerFlowPrinterPlugin (not touched). Registered with one line in
// SellerFlowBridgeViewController.

import AudioToolbox
import AVFoundation
import Capacitor
import PhotosUI
import UIKit

// MARK: - Pure logic (testable; AppTests/QrCentrePickTests.swift)
enum QrCentrePick {
    static let margin: Double = 0.15
    static let frames: Int = 2

    struct Hit: Equatable {
        let text: String
        let cx: Double
        let cy: Double
    }

    enum Verdict: Equatable {
        case none
        case one(String)
        case tie
    }

    struct Streak: Equatable {
        let text: String
        let count: Int
    }

    struct Step: Equatable {
        let streak: Streak?
        let read: String?
        let tie: Bool
    }

    /// One camera frame → none / one winner / tie.
    static func pick(_ hits: [Hit], frameCx: Double, frameCy: Double, side: Double) -> Verdict {
        guard frameCx.isFinite, frameCy.isFinite, side.isFinite, side > 0 else { return .none }
        let half = side / 2
        var best: [String: Double] = [:]
        for h in hits {
            guard !h.text.isEmpty, h.cx.isFinite, h.cy.isFinite else { continue }
            let dx = h.cx - frameCx
            let dy = h.cy - frameCy
            if abs(dx) > half || abs(dy) > half { continue }
            let d = hypot(dx, dy)
            if let prev = best[h.text], prev <= d { continue }
            best[h.text] = d
        }
        if best.isEmpty { return .none }
        let ranked = best.sorted { $0.value < $1.value }
        if ranked.count == 1 { return .one(ranked[0].key) }
        let gap = ranked[1].value - ranked[0].value
        return gap >= margin * side ? .one(ranked[0].key) : .tie
    }

    /// The next frame's verdict → new streak, text to read (or nil), show "Point at one QR".
    static func step(_ prev: Streak?, _ verdict: Verdict) -> Step {
        switch verdict {
        case .none:
            return Step(streak: nil, read: nil, tie: false)
        case .tie:
            return Step(streak: nil, read: nil, tie: true)
        case .one(let text):
            let count = (prev?.text == text) ? (prev?.count ?? 0) + 1 : 1
            return Step(streak: Streak(text: text, count: count), read: count >= frames ? text : nil, tie: false)
        }
    }
}

// MARK: - Texts (from the web, in the seller's language; English if missing)
struct ScannerTexts {
    let title, hint, one, photo, close, lightOn, lightOff, camOff, openSettings, fullScreen, camBusy, takePhoto, library, cancel: String

    init(_ o: [String: Any]?) {
        func s(_ k: String, _ fallback: String) -> String {
            if let v = o?[k] as? String, !v.isEmpty { return String(v.prefix(120)) }
            return fallback
        }
        title = s("title", "Scan sticker QR")
        hint = s("hint", "Point at the QR on the sticker")
        one = s("one", "Point at one QR")
        photo = s("photo", "Take a photo instead")
        close = s("close", "Close")
        lightOn = s("lightOn", "Turn on the light")
        lightOff = s("lightOff", "Turn off the light")
        camOff = s("camOff", "Camera is off for SellerFlowLive")
        openSettings = s("openSettings", "Open Settings")
        fullScreen = s("fullScreen", "Use SellerFlowLive full screen to scan")
        camBusy = s("camBusy", "The camera isn't available right now")
        takePhoto = s("takePhoto", "Take photo")
        library = s("library", "Choose from photos")
        cancel = s("cancel", "Cancel")
    }
}

// MARK: - Plugin
@objc(SellerFlowScannerPlugin)
public class SellerFlowScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SellerFlowScannerPlugin"
    public let jsName = "SellerFlowScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanStickerQr", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?
    private var photoFlow: StickerPhotoFlow?

    @objc func scanStickerQr(_ call: CAPPluginCall) {
        let raw: [String: Any]? = call.getObject("texts").map { $0 as [String: Any] }
        let texts = ScannerTexts(raw)
        DispatchQueue.main.async {
            if self.pending != nil {
                call.resolve(["status": "busy"])
                return
            }
            guard let host = self.bridge?.viewController else {
                call.resolve(["status": "error", "code": "no_view"])
                return
            }
            self.pending = call
            // No camera at all (e.g. the Simulator) → straight to the photo choice.
            if !QrScannerViewController.hasAnyCamera() {
                self.startPhoto(texts: texts, from: host, allowCamera: false)
                return
            }
            let vc = QrScannerViewController(texts: texts)
            vc.modalPresentationStyle = .overFullScreen
            vc.modalPresentationCapturesStatusBarAppearance = true
            vc.onDone = { [weak self] outcome in
                guard let self = self else { return }
                host.dismiss(animated: true) {
                    switch outcome {
                    case .read(let text):
                        self.finish(["status": "read", "text": text])
                    case .cancelled:
                        self.finish(["status": "cancelled"])
                    case .photo(let cameraAllowed):
                        self.startPhoto(texts: texts, from: host, allowCamera: cameraAllowed)
                    }
                }
            }
            host.present(vc, animated: true)
        }
    }

    private func startPhoto(texts: ScannerTexts, from host: UIViewController, allowCamera: Bool) {
        let flow = StickerPhotoFlow(texts: texts, allowCamera: allowCamera)
        photoFlow = flow
        flow.onDone = { [weak self] base64 in
            if let b = base64 {
                self?.finish(["status": "photo", "data": b, "mime": "image/jpeg"])
            } else {
                self?.finish(["status": "cancelled"])
            }
        }
        flow.start(from: host)
    }

    private func finish(_ result: [String: Any]) {
        let call = pending
        pending = nil
        photoFlow = nil
        call?.resolve(result)
    }
}

// MARK: - Scanner screen
final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    enum Outcome {
        case read(String)
        case cancelled
        case photo(cameraAllowed: Bool)
    }

    var onDone: ((Outcome) -> Void)?

    private let texts: ScannerTexts
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.sellerflow.live.qrscanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var device: AVCaptureDevice?
    private var configured = false
    private var denied = false
    private var torchWanted = false
    private var finished = false
    private var streak: QrCentrePick.Streak?
    private var lastCallback = Date.distantPast
    private var staleTimer: Timer?

    private let dimLayer = CAShapeLayer()
    private let frameView = UIView()
    private let closeButton = UIButton(type: .system)
    private let torchButton = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let hintLabel = UILabel()
    private let photoButton = UIButton(type: .system)
    private let panel = UIStackView()
    private let panelLabel = UILabel()
    private let settingsButton = UIButton(type: .system)

    init(texts: ScannerTexts) {
        self.texts = texts
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    static func hasAnyCamera() -> Bool {
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
            || AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildViews()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: .AVCaptureSessionWasInterrupted, object: session)
        nc.addObserver(self, selector: #selector(interruptionEnded(_:)), name: .AVCaptureSessionInterruptionEnded, object: session)
        nc.addObserver(self, selector: #selector(runtimeError(_:)), name: .AVCaptureSessionRuntimeError, object: session)
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        checkPermissionAndStart()
        staleTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.clearIfStale() }
    }

    deinit {
        staleTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        let side = min(min(view.bounds.width, view.bounds.height) * 0.68, 320)
        frameView.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        frameView.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        let path = UIBezierPath(rect: view.bounds)
        path.append(UIBezierPath(roundedRect: frameView.frame, cornerRadius: 22))
        dimLayer.frame = view.bounds
        dimLayer.path = path.cgPath
        updateVideoOrientation()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        staleTimer?.invalidate()
        setTorch(false)
        sessionQueue.async { [session] in if session.isRunning { session.stopRunning() } }
    }

    // MARK: views
    private func buildViews() {
        dimLayer.fillRule = .evenOdd
        dimLayer.fillColor = UIColor.black.withAlphaComponent(0.55).cgColor
        view.layer.addSublayer(dimLayer)

        frameView.layer.borderColor = UIColor.white.cgColor
        frameView.layer.borderWidth = 3
        frameView.layer.cornerRadius = 22
        frameView.isUserInteractionEnabled = false
        view.addSubview(frameView)

        configureRoundButton(closeButton, symbol: "xmark", label: texts.close)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        configureRoundButton(torchButton, symbol: "bolt.slash.fill", label: texts.lightOn)
        torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)
        torchButton.isHidden = true

        titleLabel.text = texts.title
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 19, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 2
        titleLabel.adjustsFontSizeToFitWidth = true

        hintLabel.text = texts.hint
        hintLabel.textColor = .white
        hintLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 2

        photoButton.setTitle(texts.photo, for: .normal)
        photoButton.setTitleColor(.white, for: .normal)
        photoButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        photoButton.titleLabel?.numberOfLines = 2
        photoButton.titleLabel?.textAlignment = .center
        photoButton.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        photoButton.layer.cornerRadius = 14
        photoButton.layer.borderWidth = 1
        photoButton.layer.borderColor = UIColor.white.withAlphaComponent(0.55).cgColor
        photoButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 18, bottom: 12, right: 18)
        photoButton.addTarget(self, action: #selector(photoTapped), for: .touchUpInside)

        panelLabel.textColor = .white
        panelLabel.font = .systemFont(ofSize: 17, weight: .bold)
        panelLabel.textAlignment = .center
        panelLabel.numberOfLines = 0
        settingsButton.setTitle(texts.openSettings, for: .normal)
        settingsButton.setTitleColor(.black, for: .normal)
        settingsButton.backgroundColor = .white
        settingsButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        settingsButton.layer.cornerRadius = 12
        settingsButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 22, bottom: 12, right: 22)
        settingsButton.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)
        panel.axis = .vertical
        panel.alignment = .center
        panel.spacing = 16
        panel.addArrangedSubview(panelLabel)
        panel.addArrangedSubview(settingsButton)
        panel.isHidden = true

        for v in [closeButton, torchButton, titleLabel, hintLabel, photoButton, panel] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            closeButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            closeButton.widthAnchor.constraint(equalToConstant: 46),
            closeButton.heightAnchor.constraint(equalToConstant: 46),
            torchButton.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -14),
            torchButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            torchButton.widthAnchor.constraint(equalToConstant: 46),
            torchButton.heightAnchor.constraint(equalToConstant: 46),
            titleLabel.topAnchor.constraint(equalTo: closeButton.bottomAnchor, constant: 10),
            titleLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24),
            titleLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),
            hintLabel.topAnchor.constraint(equalTo: frameView.bottomAnchor, constant: 18),
            hintLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24),
            hintLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),
            photoButton.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -18),
            photoButton.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            photoButton.leadingAnchor.constraint(greaterThanOrEqualTo: g.leadingAnchor, constant: 20),
            photoButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
            panel.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            panel.centerYAnchor.constraint(equalTo: g.centerYAnchor),
            panel.leadingAnchor.constraint(greaterThanOrEqualTo: g.leadingAnchor, constant: 28),
        ])
    }

    private func configureRoundButton(_ b: UIButton, symbol: String, label: String) {
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .bold)), for: .normal)
        b.tintColor = .white
        b.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        b.layer.cornerRadius = 23
        b.accessibilityLabel = label
    }

    private func showPanel(_ text: String?, settings: Bool) {
        guard let text = text else {
            panel.isHidden = true
            frameView.isHidden = false
            hintLabel.isHidden = false
            return
        }
        panelLabel.text = text
        settingsButton.isHidden = !settings
        panel.isHidden = false
        frameView.isHidden = true
        hintLabel.isHidden = true
        torchButton.isHidden = true
    }

    // MARK: permission + camera
    private func checkPermissionAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            denied = false
            showPanel(nil, settings: false)
            configureIfNeeded()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async { ok ? self.checkPermissionAndStart() : self.showDenied() }
            }
        default:
            showDenied()
        }
    }

    private func showDenied() {
        denied = true
        showPanel(texts.camOff, settings: true)
    }

    private func configureIfNeeded() {
        if configured {
            sessionQueue.async { [session] in if !session.isRunning { session.startRunning() } }
            return
        }
        configured = true
        let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        guard let camera = dev, let input = try? AVCaptureDeviceInput(device: camera) else {
            showPanel(texts.camBusy, settings: false)
            return
        }
        device = camera
        let output = AVCaptureMetadataOutput()
        session.beginConfiguration()
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(output) { session.addOutput(output) }
        if output.availableMetadataObjectTypes.contains(.qr) {
            output.metadataObjectTypes = [.qr]
        }
        output.setMetadataObjectsDelegate(self, queue: .main)
        if #available(iOS 16.0, *), session.isMultitaskingCameraAccessSupported {
            session.isMultitaskingCameraAccessEnabled = true
        }
        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
        updateVideoOrientation()
        torchButton.isHidden = !(camera.hasTorch && camera.isTorchAvailable)
        sessionQueue.async { [session] in session.startRunning() }
    }

    private func updateVideoOrientation() {
        guard let connection = previewLayer?.connection else { return }
        let o = view.window?.windowScene?.interfaceOrientation ?? .portrait
        if #available(iOS 17.0, *) {
            let angle: CGFloat
            switch o {
            case .landscapeRight: angle = 0
            case .landscapeLeft: angle = 180
            case .portraitUpsideDown: angle = 270
            default: angle = 90
            }
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        } else if connection.isVideoOrientationSupported {
            switch o {
            case .landscapeRight: connection.videoOrientation = .landscapeRight
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            default: connection.videoOrientation = .portrait
            }
        }
    }

    // Background → the camera pauses by itself (session interrupted); back → it resumes and the
    // light comes back on if it was on. iPad Split View / Slide Over without camera access → message.
    @objc private func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int,
              let reason = AVCaptureSession.InterruptionReason(rawValue: raw) else { return }
        switch reason {
        case .videoDeviceNotAvailableWithMultipleForegroundApps:
            showPanel(texts.fullScreen, settings: false)
        case .videoDeviceInUseByAnotherClient:
            showPanel(texts.camBusy, settings: false)
        default:
            break
        }
    }

    @objc private func interruptionEnded(_ n: Notification) {
        if !denied { showPanel(nil, settings: false) }
        torchButton.isHidden = !(device?.hasTorch == true && device?.isTorchAvailable == true)
        if torchWanted { setTorch(true) }
    }

    @objc private func runtimeError(_ n: Notification) {
        let err = n.userInfo?[AVCaptureSessionErrorKey] as? AVError
        if err?.code == .mediaServicesWereReset {
            sessionQueue.async { [session] in if !session.isRunning { session.startRunning() } }
        } else {
            showPanel(texts.camBusy, settings: false)
        }
    }

    @objc private func becameActive() {
        if finished { return }
        if denied {
            checkPermissionAndStart()
            return
        }
        if configured {
            sessionQueue.async { [session] in if !session.isRunning { session.startRunning() } }
            if torchWanted {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.setTorch(true) }
            }
        }
    }

    // MARK: reading
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !finished, let layer = previewLayer else { return }
        lastCallback = Date()
        var hits: [QrCentrePick.Hit] = []
        for obj in metadataObjects {
            guard let code = obj as? AVMetadataMachineReadableCodeObject, code.type == .qr,
                  let text = code.stringValue, !text.isEmpty,
                  let t = layer.transformedMetadataObject(for: code) else { continue }
            hits.append(QrCentrePick.Hit(text: text, cx: Double(t.bounds.midX), cy: Double(t.bounds.midY)))
        }
        let f = frameView.frame
        let verdict = QrCentrePick.pick(hits, frameCx: Double(f.midX), frameCy: Double(f.midY), side: Double(f.width))
        let step = QrCentrePick.step(streak, verdict)
        streak = step.streak
        hintLabel.text = step.tie ? texts.one : texts.hint
        if let text = step.read { read(text) }
    }

    private func clearIfStale() {
        if finished { return }
        if Date().timeIntervalSince(lastCallback) > 0.6 {
            streak = nil
            if hintLabel.text != texts.hint { hintLabel.text = texts.hint }
        }
    }

    private func read(_ text: String) {
        finished = true
        ScanFeedback.play()
        setTorch(false)
        onDone?(.read(text))
    }

    // MARK: buttons
    @objc private func closeTapped() {
        guard !finished else { return }
        finished = true
        onDone?(.cancelled)
    }

    @objc private func photoTapped() {
        guard !finished else { return }
        finished = true
        setTorch(false)
        let cameraAllowed = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        onDone?(.photo(cameraAllowed: cameraAllowed))
    }

    @objc private func torchTapped() {
        torchWanted.toggle()
        setTorch(torchWanted)
    }

    @objc private func settingsTapped() {
        // Native open (the iPhone app cannot open Settings from the web page).
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func setTorch(_ on: Bool) {
        guard let d = device, d.hasTorch, d.isTorchAvailable else { return }
        do {
            try d.lockForConfiguration()
            d.torchMode = on ? .on : .off
            d.unlockForConfiguration()
        } catch {
            return
        }
        torchButton.setImage(UIImage(systemName: on ? "bolt.fill" : "bolt.slash.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .bold)), for: .normal)
        torchButton.accessibilityLabel = on ? texts.lightOff : texts.lightOn
    }
}

// MARK: - Beep + haptic tap
enum ScanFeedback {
    private static var soundId: SystemSoundID = 0

    static func play() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if soundId == 0 { soundId = makeBeep() }
        if soundId != 0 { AudioServicesPlaySystemSound(soundId) }
    }

    /// A 0.12 s 2.6 kHz tone, made once as a small WAV in the temp folder. A system sound follows
    /// the silent switch and never touches the app's audio session.
    private static func makeBeep() -> SystemSoundID {
        let rate = 22050
        let count = rate * 12 / 100
        var pcm = Data(capacity: count * 2)
        for i in 0..<count {
            let fade = min(1.0, Double(min(i, count - i)) / Double(rate / 200))
            let v = sin(2.0 * Double.pi * 2600.0 * Double(i) / Double(rate)) * 0.5 * fade
            var sample = Int16(max(-1, min(1, v)) * Double(Int16.max)).littleEndian
            withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
        }
        var wav = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { wav.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { wav.append(contentsOf: $0) } }
        wav.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count))
        wav.append(contentsOf: Array("WAVE".utf8))
        wav.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        wav.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
        wav.append(pcm)
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("sfl-scan-beep.wav")
        do { try wav.write(to: url, options: .atomic) } catch { return 0 }
        var id: SystemSoundID = 0
        return AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError ? id : 0
    }
}

// MARK: - "Take a photo instead": the phone's own Take photo / Choose from photos
final class StickerPhotoFlow: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {
    var onDone: ((String?) -> Void)?
    private let texts: ScannerTexts
    private let allowCamera: Bool
    private var done = false

    init(texts: ScannerTexts, allowCamera: Bool) {
        self.texts = texts
        self.allowCamera = allowCamera
    }

    func start(from host: UIViewController) {
        let canCamera = allowCamera && UIImagePickerController.isSourceTypeAvailable(.camera)
        if !canCamera {
            openLibrary(from: host)
            return
        }
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: texts.takePhoto, style: .default) { _ in self.openCamera(from: host) })
        sheet.addAction(UIAlertAction(title: texts.library, style: .default) { _ in self.openLibrary(from: host) })
        sheet.addAction(UIAlertAction(title: texts.cancel, style: .cancel) { _ in self.complete(nil) })
        if let pop = sheet.popoverPresentationController { // iPad
            pop.sourceView = host.view
            pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.maxY - 40, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        host.present(sheet, animated: true)
    }

    private func openCamera(from host: UIViewController) {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        host.present(picker, animated: true)
    }

    private func openLibrary(from host: UIViewController) {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        host.present(picker, animated: true)
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true) { self.complete(image) }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { self.complete(nil) }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            complete(nil)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { object, _ in
            DispatchQueue.main.async { self.complete(object as? UIImage) }
        }
    }

    private func complete(_ image: UIImage?) {
        if done { return }
        done = true
        guard let image = image else {
            onDone?(nil)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let b64 = StickerPhotoFlow.jpegBase64(image)
            DispatchQueue.main.async { self.onDone?(b64) }
        }
    }

    /// Long side ≤ 4032 px (a 12 MP photo stays as it is), JPEG 0.9. A QR reads the same at any turn.
    static func jpegBase64(_ image: UIImage) -> String? {
        let maxEdge: CGFloat = 4032
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        var out = image
        if max(w, h) > maxEdge, w > 0, h > 0 {
            let k = maxEdge / max(w, h)
            let size = CGSize(width: floor(w * k), height: floor(h * k))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            out = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        }
        return out.jpegData(compressionQuality: 0.9)?.base64EncodedString()
    }
}
