import Combine
import Foundation

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var apiURL: String {
        didSet { UserDefaults.standard.set(apiURL, forKey: Keys.apiURL) }
    }

    @Published var latestResultURL: String? {
        didSet { UserDefaults.standard.set(latestResultURL, forKey: Keys.latestResultURL) }
    }

    @Published var statusMessage: String = "Ready"
    @Published var isProcessing: Bool = false

    private enum Keys {
        static let apiURL = "Athena.apiURL"
        static let latestResultURL = "Athena.latestResultURL"
    }

    private init() {
        let envURL = ProcessInfo.processInfo.environment["MAC_API_URL"]
        apiURL = UserDefaults.standard.string(forKey: Keys.apiURL) ?? envURL ?? "http://localhost:4000"
        latestResultURL = UserDefaults.standard.string(forKey: Keys.latestResultURL)
    }
}
