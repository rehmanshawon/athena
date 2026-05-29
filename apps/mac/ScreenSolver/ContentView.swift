import AppKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var settings: AppSettings
    @State private var permissionStatus = "Not checked"

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: "sparkles.rectangle.stack")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ScreenSolver")
                        .font(.title2)
                        .fontWeight(.semibold)
                    Text("Command + Shift + Y captures your primary display.")
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Backend URL")
                    .font(.headline)
                TextField("http://localhost:4000", text: $settings.backendURL)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Status")
                    .font(.headline)
                Text(settings.statusMessage)
                    .foregroundStyle(settings.isProcessing ? .orange : .primary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("Check Permission") {
                    Task { await checkPermission() }
                }
                Button("Open Latest Result") {
                    openLatestResult()
                }
                .disabled(settings.latestResultURL == nil)
            }

            Text(permissionStatus)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)
        }
        .padding(22)
        .frame(width: 460, height: 270)
        .task {
            await checkPermission()
        }
    }

    private func checkPermission() async {
        switch await PermissionService.checkScreenRecordingPermission() {
        case .success:
            permissionStatus = "Screen Recording permission granted."
        case .failure:
            permissionStatus = "Screen Recording permission missing. Enable it in System Settings > Privacy & Security > Screen Recording, then relaunch."
        }
    }

    private func openLatestResult() {
        guard let value = settings.latestResultURL, let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }
}
