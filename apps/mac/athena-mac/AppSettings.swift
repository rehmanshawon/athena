import Combine
import Foundation

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var apiURL: String {
        didSet { UserDefaults.standard.set(apiURL, forKey: Keys.apiURL) }
    }

    @Published var codingStack: String {
        didSet { UserDefaults.standard.set(codingStack, forKey: Keys.codingStack) }
    }

    @Published var autoCaptureEnabled: Bool {
        didSet { UserDefaults.standard.set(autoCaptureEnabled, forKey: Keys.autoCaptureEnabled) }
    }

    @Published var autoCaptureIntervalSeconds: Double {
        didSet { UserDefaults.standard.set(autoCaptureIntervalSeconds, forKey: Keys.autoCaptureIntervalSeconds) }
    }

    @Published var latestResultURL: String? {
        didSet { UserDefaults.standard.set(latestResultURL, forKey: Keys.latestResultURL) }
    }

    @Published var statusMessage: String = "Ready"
    @Published var webCaptureStatusMessage: String = "Web request polling has not started."
    @Published var isProcessing: Bool = false

    private enum Keys {
        static let apiURL = "Athena.apiURL"
        static let codingStack = "Athena.codingStack"
        static let autoCaptureEnabled = "Athena.autoCaptureEnabled"
        static let autoCaptureIntervalSeconds = "Athena.autoCaptureIntervalSeconds"
        static let latestResultURL = "Athena.latestResultURL"
    }

    static let codingStackOptions = [
        "TypeScript",
        "JavaScript",
        "Python",
        "React",
        "Dart",
        "C#",
        "Java",
        "Swift",
        "Go",
        "Rust"
    ]

    private init() {
        let envURL = ProcessInfo.processInfo.environment["MAC_API_URL"]
        apiURL = UserDefaults.standard.string(forKey: Keys.apiURL) ?? envURL ?? "http://localhost:4000"
        codingStack = UserDefaults.standard.string(forKey: Keys.codingStack) ?? "TypeScript"
        autoCaptureEnabled = UserDefaults.standard.bool(forKey: Keys.autoCaptureEnabled)

        let savedInterval = UserDefaults.standard.double(forKey: Keys.autoCaptureIntervalSeconds)
        autoCaptureIntervalSeconds = savedInterval > 0 ? savedInterval : 10
        latestResultURL = UserDefaults.standard.string(forKey: Keys.latestResultURL)
    }

    var safeAutoCaptureIntervalSeconds: UInt64 {
        UInt64(max(3, min(3600, autoCaptureIntervalSeconds)).rounded())
    }
}
