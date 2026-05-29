import Combine
import Foundation

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var backendURL: String {
        didSet { UserDefaults.standard.set(backendURL, forKey: Keys.backendURL) }
    }

    @Published var latestResultURL: String? {
        didSet { UserDefaults.standard.set(latestResultURL, forKey: Keys.latestResultURL) }
    }

    @Published var statusMessage: String = "Ready"
    @Published var isProcessing: Bool = false

    private enum Keys {
        static let backendURL = "ScreenSolver.backendURL"
        static let latestResultURL = "ScreenSolver.latestResultURL"
    }

    private init() {
        let envURL = ProcessInfo.processInfo.environment["MAC_BACKEND_URL"]
        backendURL = UserDefaults.standard.string(forKey: Keys.backendURL) ?? envURL ?? "http://localhost:4000"
        latestResultURL = UserDefaults.standard.string(forKey: Keys.latestResultURL)
    }
}
