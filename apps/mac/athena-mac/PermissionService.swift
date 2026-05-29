import Foundation
import ScreenCaptureKit

enum PermissionService {
    static func checkScreenRecordingPermission() async -> Result<Void, Error> {
        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            return .success(())
        } catch {
            return .failure(error)
        }
    }
}
