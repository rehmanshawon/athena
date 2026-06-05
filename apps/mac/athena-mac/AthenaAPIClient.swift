import Foundation

enum AthenaAPIClientError: LocalizedError {
    case invalidAPIURL
    case invalidResponse
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidAPIURL:
            return "Athena API URL is invalid."
        case .invalidResponse:
            return "Athena API returned an invalid response."
        case .serverError(let message):
            return message
        }
    }
}

struct CaptureUploadResponse: Decodable {
    let sessionId: String
    let status: String
    let webUrl: String
    let captureCount: Int?
}

struct SolverSession: Decodable {
    let id: String
    let status: String
    let finalAnswer: String
    let error: String?
    let captures: [CaptureImage]?

    var captureCount: Int {
        captures?.count ?? 1
    }
}

struct CaptureImage: Decodable {
    let id: String
    let createdAt: String
}

final class AthenaAPIClient {
    func uploadScreenshot(
        _ imageData: Data,
        apiURL: String,
        codingStack: String,
        sessionId: String? = nil,
        analysisDelayMs: Int = 0
    ) async throws -> CaptureUploadResponse {
        guard let url = endpointURL(apiURL: apiURL, path: "api/captures") else {
            throw AthenaAPIClientError.invalidAPIURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = makeMultipartBody(
            imageData: imageData,
            boundary: boundary,
            codingStack: codingStack,
            sessionId: sessionId,
            analysisDelayMs: analysisDelayMs
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AthenaAPIClientError.invalidResponse
        }

        guard (200...299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Upload failed with status \(http.statusCode)."
            throw AthenaAPIClientError.serverError(message)
        }

        return try JSONDecoder().decode(CaptureUploadResponse.self, from: data)
    }

    func fetchSession(sessionId: String, apiURL: String) async throws -> SolverSession {
        guard let url = endpointURL(apiURL: apiURL, path: "api/sessions/\(sessionId)") else {
            throw AthenaAPIClientError.invalidAPIURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AthenaAPIClientError.invalidResponse
        }

        return try JSONDecoder().decode(SolverSession.self, from: data)
    }

    private func endpointURL(apiURL: String, path: String) -> URL? {
        let base = apiURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: "\(base)/\(path)")
    }

    private func makeMultipartBody(imageData: Data, boundary: String, codingStack: String, sessionId: String?, analysisDelayMs: Int) -> Data {
        var body = Data()
        appendTextField(name: "codingStack", value: codingStack, boundary: boundary, body: &body)
        appendTextField(name: "analysisDelayMs", value: String(max(0, analysisDelayMs)), boundary: boundary, body: &body)
        if let sessionId, !sessionId.isEmpty {
            appendTextField(name: "sessionId", value: sessionId, boundary: boundary, body: &body)
        }
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"screenshot\"; filename=\"screenshot.png\"\r\n")
        body.append("Content-Type: image/png\r\n\r\n")
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n")
        return body
    }

    private func appendTextField(name: String, value: String, boundary: String, body: inout Data) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        body.append(value)
        body.append("\r\n")
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}
