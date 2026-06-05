import CoreGraphics
import Foundation

enum ScreenRecordingPermissionError: LocalizedError {
    case missing

    var errorDescription: String? {
        "Screen Recording permission is not granted."
    }
}

enum PermissionService {
    static func checkScreenRecordingPermission() async -> Result<Void, Error> {
        if CGPreflightScreenCaptureAccess() {
            return .success(())
        }

        return .failure(ScreenRecordingPermissionError.missing)
    }
}
