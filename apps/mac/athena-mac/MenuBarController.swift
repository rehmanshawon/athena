import AppKit
import Carbon
import Combine
import Foundation
import SwiftUI

@MainActor
final class MenuBarController: NSObject, NSApplicationDelegate {
    private let settings = AppSettings.shared
    private let captureService = ScreenCaptureService()
    private let apiClient = AthenaAPIClient()
    private var statusItem: NSStatusItem?
    private var settingsWindow: NSWindow?
    private var hotKeyManager: HotKeyManager?
    private var autoCaptureTask: Task<Void, Never>?
    private var webCaptureTask: Task<Void, Never>?
    private var activeAutoCaptureSessionId: String?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        hotKeyManager = HotKeyManager { [weak self] in
            Task { @MainActor in
                self?.captureNow()
            }
        }
        observeAutoCaptureSettings()
        updateAutoCaptureTask()
        startWebCapturePolling()
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "sparkles.rectangle.stack", accessibilityDescription: "Athena") {
            item.button?.image = image
            item.button?.imagePosition = .imageOnly
        } else {
            item.button?.title = "A"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Capture Now (⌘⇧Y)", action: #selector(captureMenuItem), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Open Latest Result", action: #selector(openLatestResult), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Check Permission", action: #selector(checkPermission), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Settings", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))

        for item in menu.items {
            item.target = self
        }

        item.menu = menu
        statusItem = item
    }

    @objc private func captureMenuItem() {
        activeAutoCaptureSessionId = nil
        captureNow()
    }

    private func captureNow() {
        Task { await performCapture(mode: .single) }
    }

    private func observeAutoCaptureSettings() {
        settings.$autoCaptureEnabled
            .dropFirst()
            .sink { [weak self] _ in
                Task { @MainActor in self?.updateAutoCaptureTask() }
            }
            .store(in: &cancellables)

        settings.$autoCaptureIntervalSeconds
            .dropFirst()
            .sink { [weak self] _ in
                Task { @MainActor in self?.updateAutoCaptureTask() }
            }
            .store(in: &cancellables)
    }

    private func updateAutoCaptureTask() {
        autoCaptureTask?.cancel()
        autoCaptureTask = nil

        guard settings.autoCaptureEnabled else {
            activeAutoCaptureSessionId = nil
            return
        }

        autoCaptureTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let seconds = await MainActor.run { self.settings.safeAutoCaptureIntervalSeconds }
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)

                if Task.isCancelled { return }
                await self.performCapture(mode: .auto)
            }
        }
    }

    private func startWebCapturePolling() {
        webCaptureTask?.cancel()
        webCaptureTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let apiURL = await MainActor.run { self.settings.apiURL }
                    if let request = try await self.apiClient.fetchNextCaptureRequest(apiURL: apiURL) {
                        await self.performCapture(mode: .webRequest(request))
                    }
                } catch {
                    await MainActor.run {
                        self.settings.statusMessage = "Web capture polling failed: \(error.localizedDescription)"
                    }
                }

                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func performCapture(mode: CaptureMode) async {
        let isAutoCapture: Bool
        let webRequest: CaptureRequest?
        switch mode {
        case .auto:
            isAutoCapture = true
            webRequest = nil
        case .single:
            isAutoCapture = false
            webRequest = nil
        case .webRequest(let request):
            isAutoCapture = false
            webRequest = request
        }

        guard isAutoCapture || !settings.isProcessing else { return }
        settings.isProcessing = true
        settings.statusMessage = "Checking Screen Recording permission..."

        do {
            switch await PermissionService.checkScreenRecordingPermission() {
            case .success:
                break
            case .failure(let error):
                throw error
            }

            settings.statusMessage = "Capturing screenshot..."

            let screenshot = try await captureService.capturePrimaryDisplayPNG()
            guard !screenshot.isEmpty else {
                throw ScreenCaptureError.emptyScreenshot
            }

            settings.statusMessage = "Uploading screenshot..."

            let response = try await apiClient.uploadScreenshot(
                screenshot,
                apiURL: settings.apiURL,
                codingStack: settings.codingStack,
                sessionId: webRequest?.sessionId ?? (isAutoCapture ? activeAutoCaptureSessionId : nil),
                requestId: webRequest?.id,
                deferAnalysis: webRequest != nil,
                analysisDelayMs: isAutoCapture ? autoCaptureAnalysisDelayMs() : 0
            )
            if isAutoCapture {
                activeAutoCaptureSessionId = response.sessionId
            }
            settings.latestResultURL = response.webUrl
            let captureCount = response.captureCount ?? 1
            if isAutoCapture {
                settings.statusMessage = "Captured page \(captureCount). Analyzing after scrolling pauses..."
            } else if webRequest != nil {
                settings.statusMessage = "Captured thumbnail \(captureCount). Waiting for web solve."
            } else {
                settings.statusMessage = "Processing session \(response.sessionId)..."
            }

            if isAutoCapture || webRequest != nil {
                settings.isProcessing = false
            } else {
                try await pollSessionUntilFinished(sessionId: response.sessionId)
            }
        } catch {
            settings.statusMessage = "Failed: \(error.localizedDescription)"
            settings.isProcessing = false
        }
    }

    private func autoCaptureAnalysisDelayMs() -> Int {
        Int((settings.safeAutoCaptureIntervalSeconds + 2) * 1_000)
    }

    private func pollSessionUntilFinished(sessionId: String) async throws {
        for _ in 0..<90 {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            let session = try await apiClient.fetchSession(sessionId: sessionId, apiURL: settings.apiURL)
            if session.status == "completed" {
                settings.statusMessage = "Result ready"
                settings.isProcessing = false
                return
            }

            if session.status == "failed" {
                let message = session.error ?? "Processing failed"
                settings.statusMessage = "Failed: \(message)"
                settings.isProcessing = false
                return
            }
        }

        settings.statusMessage = "Still processing. Open the result page to continue watching."
        settings.isProcessing = false
    }

    @objc private func openLatestResult() {
        guard let value = settings.latestResultURL, let url = URL(string: value) else {
            settings.statusMessage = "No result has been captured yet."
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func checkPermission() {
        Task {
            switch await PermissionService.checkScreenRecordingPermission() {
            case .success:
                await MainActor.run {
                    settings.statusMessage = "Screen Recording permission granted"
                }
            case .failure(let error):
                await MainActor.run {
                    settings.statusMessage = "Permission missing: \(error.localizedDescription)"
                }
            }
        }
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 460, height: 410),
                styleMask: [.titled, .closable, .miniaturizable],
                backing: .buffered,
                defer: false
            )
            window.title = "Athena Settings"
            window.contentView = NSHostingView(rootView: ContentView(settings: settings))
            window.center()
            settingsWindow = window
        }

        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

private enum CaptureMode {
    case single
    case auto
    case webRequest(CaptureRequest)
}

private final class HotKeyManager {
    private var eventHandler: EventHandlerRef?
    private var hotKeyRef: EventHotKeyRef?
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
        install()
    }

    deinit {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }
        if let eventHandler {
            RemoveEventHandler(eventHandler)
        }
    }

    private func install() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let userData = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())

        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async {
                manager.action()
            }
            return noErr
        }, 1, &eventType, userData, &eventHandler)

        let hotKeyID = EventHotKeyID(signature: fourCharCode("ATHN"), id: 1)
        RegisterEventHotKey(
            UInt32(kVK_ANSI_Y),
            UInt32(cmdKey | shiftKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }
}

private func fourCharCode(_ value: String) -> OSType {
    value.utf8.reduce(0) { result, character in
        (result << 8) + OSType(character)
    }
}
