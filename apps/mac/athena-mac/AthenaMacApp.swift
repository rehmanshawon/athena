import SwiftUI

@main
struct AthenaMacApp: App {
    @NSApplicationDelegateAdaptor(MenuBarController.self) private var appDelegate

    var body: some Scene {
        Settings {
            ContentView(settings: .shared)
        }
    }
}
