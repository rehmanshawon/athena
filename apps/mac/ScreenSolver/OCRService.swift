import AppKit
import Foundation
import Vision

enum OCRService {
    static func recognizeText(from imageData: Data) async throws -> String {
        guard
            let image = NSImage(data: imageData),
            let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let cgImage = bitmap.cgImage
        else {
            return ""
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["en-US"]
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try handler.perform([request])

        return request.results?
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n") ?? ""
    }
}
