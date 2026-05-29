import SwiftUI

@main
struct ScreenSolverApp: App {
    @NSApplicationDelegateAdaptor(MenuBarController.self) private var appDelegate

    var body: some Scene {
        Settings {
            ContentView(settings: .shared)
        }
    }
}
