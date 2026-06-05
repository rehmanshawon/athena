import AppKit
import CoreGraphics
import Foundation

enum ScreenCaptureError: LocalizedError {
    case missingDisplay
    case emptyScreenshot

    var errorDescription: String? {
        switch self {
        case .missingDisplay:
            return "Primary display was not found."
        case .emptyScreenshot:
            return "ScreenCaptureKit returned an empty screenshot."
        }
    }
}

final class ScreenCaptureService {
    func capturePrimaryDisplayPNG() async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            let displayID = CGMainDisplayID()
            guard displayID != CGDirectDisplayID(0) else {
                throw ScreenCaptureError.missingDisplay
            }

            guard
                let image = CGDisplayCreateImage(displayID),
                let pngData = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
                !pngData.isEmpty
            else {
                throw ScreenCaptureError.emptyScreenshot
            }

            return pngData
        }.value
    }
}
