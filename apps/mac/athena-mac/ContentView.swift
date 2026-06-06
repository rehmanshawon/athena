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
                    Text("Athena")
                        .font(.title2)
                        .fontWeight(.semibold)
                    Text("Command + Shift + Y captures your primary display.")
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Athena API URL")
                    .font(.headline)
                TextField("http://localhost:4000", text: $settings.apiURL)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Coding Language / Stack")
                    .font(.headline)
                Picker("Coding Language / Stack", selection: $settings.codingStack) {
                    ForEach(AppSettings.codingStackOptions, id: \.self) { option in
                        Text(option).tag(option)
                    }
                }
                .pickerStyle(.menu)
                Text("Used when Athena detects a coding challenge.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Toggle("Allow Timed Auto Capture", isOn: $settings.autoCaptureEnabled)
                    Spacer()
                    Button("Stop Auto Capture") {
                        settings.autoCaptureEnabled = false
                    }
                    .disabled(!settings.autoCaptureEnabled)
                }
                HStack {
                    Text("Interval")
                    Stepper(
                        value: $settings.autoCaptureIntervalSeconds,
                        in: 3...3600,
                        step: 1
                    ) {
                        Text("\(Int(settings.autoCaptureIntervalSeconds.rounded())) seconds")
                            .monospacedDigit()
                    }
                }
                .disabled(!settings.autoCaptureEnabled)
                Text(settings.autoCaptureEnabled ? "Timed capture is running in the background." : "Timed capture is stopped. Web and hotkey captures still work.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
        .frame(width: 500, height: 430)
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
