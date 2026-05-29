import AppKit
import CoreImage
import CoreMedia
import Foundation
import ScreenCaptureKit

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
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.frame.origin == .zero }) ?? content.displays.first else {
            throw ScreenCaptureError.missingDisplay
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.width = Int(display.width)
        config.height = Int(display.height)
        config.queueDepth = 1
        config.showsCursor = true
        config.capturesAudio = false

        let output = SingleFrameCaptureOutput()
        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: .main)
        try await stream.startCapture()

        guard let pngData = await output.waitForFrame(), !pngData.isEmpty else {
            try? await stream.stopCapture()
            throw ScreenCaptureError.emptyScreenshot
        }

        try await stream.stopCapture()
        return pngData
    }
}

final class SingleFrameCaptureOutput: NSObject, SCStreamOutput {
    private var continuation: CheckedContinuation<Data?, Never>?

    func waitForFrame() async -> Data? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let buffer = sampleBuffer.imageBuffer else {
            resume(nil)
            return
        }

        let ciImage = CIImage(cvPixelBuffer: buffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            resume(nil)
            return
        }

        let image = NSImage(cgImage: cgImage, size: NSSize(width: ciImage.extent.width, height: ciImage.extent.height))
        guard
            let tiff = image.tiffRepresentation,
            let rep = NSBitmapImageRep(data: tiff),
            let png = rep.representation(using: .png, properties: [:])
        else {
            resume(nil)
            return
        }

        resume(png)
    }

    private func resume(_ data: Data?) {
        continuation?.resume(returning: data)
        continuation = nil
    }
}
