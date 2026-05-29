import AppKit
import Carbon
import Foundation
import SwiftUI

@MainActor
final class MenuBarController: NSObject, NSApplicationDelegate {
    private let settings = AppSettings.shared
    private let captureService = ScreenCaptureService()
    private let backendClient = BackendClient()
    private var statusItem: NSStatusItem?
    private var settingsWindow: NSWindow?
    private var hotKeyManager: HotKeyManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NotificationService.requestAuthorization()
        configureStatusItem()
        hotKeyManager = HotKeyManager { [weak self] in
            Task { @MainActor in
                self?.captureNow()
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.openSettings()
        }
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "sparkles.rectangle.stack", accessibilityDescription: "ScreenSolver") {
            item.button?.image = image
            item.button?.imagePosition = .imageOnly
        } else {
            item.button?.title = "SS"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Capture Now", action: #selector(captureMenuItem), keyEquivalent: ""))
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
        captureNow()
    }

    private func captureNow() {
        guard !settings.isProcessing else { return }
        settings.isProcessing = true
        settings.statusMessage = "Checking Screen Recording permission..."

        Task {
            do {
                switch await PermissionService.checkScreenRecordingPermission() {
                case .success:
                    break
                case .failure(let error):
                    throw error
                }

                await MainActor.run {
                    settings.statusMessage = "Capturing screenshot..."
                }

                let screenshot = try await captureService.capturePrimaryDisplayPNG()
                guard !screenshot.isEmpty else {
                    throw ScreenCaptureError.emptyScreenshot
                }

                NotificationService.show(title: "ScreenSolver", body: "Processing started")

                await MainActor.run {
                    settings.statusMessage = "Uploading screenshot..."
                }

                let response = try await backendClient.uploadScreenshot(screenshot, backendURL: settings.backendURL)
                await MainActor.run {
                    settings.latestResultURL = response.webUrl
                    settings.statusMessage = "Processing session \(response.sessionId)..."
                }

                try await pollSessionUntilFinished(sessionId: response.sessionId)
            } catch {
                await MainActor.run {
                    settings.statusMessage = "Failed: \(error.localizedDescription)"
                    settings.isProcessing = false
                }
                NotificationService.show(title: "ScreenSolver failed", body: error.localizedDescription)
            }
        }
    }

    private func pollSessionUntilFinished(sessionId: String) async throws {
        for _ in 0..<90 {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            let session = try await backendClient.fetchSession(sessionId: sessionId, backendURL: settings.backendURL)
            if session.status == "completed" {
                await MainActor.run {
                    settings.statusMessage = "Result ready"
                    settings.isProcessing = false
                }
                NotificationService.show(title: "ScreenSolver", body: "Result ready")
                return
            }

            if session.status == "failed" {
                let message = session.error ?? "Processing failed"
                await MainActor.run {
                    settings.statusMessage = "Failed: \(message)"
                    settings.isProcessing = false
                }
                NotificationService.show(title: "ScreenSolver failed", body: message)
                return
            }
        }

        await MainActor.run {
            settings.statusMessage = "Still processing. Open the result page to continue watching."
            settings.isProcessing = false
        }
    }

    @objc private func openLatestResult() {
        guard let value = settings.latestResultURL, let url = URL(string: value) else {
            NotificationService.show(title: "ScreenSolver", body: "No result has been captured yet.")
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
                NotificationService.show(title: "ScreenSolver", body: "Screen Recording permission granted")
            case .failure(let error):
                await MainActor.run {
                    settings.statusMessage = "Permission missing: \(error.localizedDescription)"
                }
                NotificationService.show(
                    title: "Screen Recording permission required",
                    body: "Enable ScreenSolver in System Settings > Privacy & Security > Screen Recording, then relaunch."
                )
            }
        }
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 460, height: 270),
                styleMask: [.titled, .closable, .miniaturizable],
                backing: .buffered,
                defer: false
            )
            window.title = "ScreenSolver Settings"
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

        let hotKeyID = EventHotKeyID(signature: fourCharCode("SSHK"), id: 1)
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
