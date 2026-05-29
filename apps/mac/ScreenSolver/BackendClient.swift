import Foundation

enum BackendClientError: LocalizedError {
    case invalidBackendURL
    case invalidResponse
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidBackendURL:
            return "Backend URL is invalid."
        case .invalidResponse:
            return "Backend returned an invalid response."
        case .serverError(let message):
            return message
        }
    }
}

struct CaptureUploadResponse: Decodable {
    let sessionId: String
    let status: String
    let webUrl: String
}

struct SolverSession: Decodable {
    let id: String
    let status: String
    let finalAnswer: String
    let error: String?
}

final class BackendClient {
    func uploadScreenshot(_ imageData: Data, backendURL: String) async throws -> CaptureUploadResponse {
        guard let url = endpointURL(backendURL: backendURL, path: "api/captures") else {
            throw BackendClientError.invalidBackendURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = makeMultipartBody(imageData: imageData, boundary: boundary)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.invalidResponse
        }

        guard (200...299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Upload failed with status \(http.statusCode)."
            throw BackendClientError.serverError(message)
        }

        return try JSONDecoder().decode(CaptureUploadResponse.self, from: data)
    }

    func fetchSession(sessionId: String, backendURL: String) async throws -> SolverSession {
        guard let url = endpointURL(backendURL: backendURL, path: "api/sessions/\(sessionId)") else {
            throw BackendClientError.invalidBackendURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw BackendClientError.invalidResponse
        }

        return try JSONDecoder().decode(SolverSession.self, from: data)
    }

    private func endpointURL(backendURL: String, path: String) -> URL? {
        let base = backendURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: "\(base)/\(path)")
    }

    private func makeMultipartBody(imageData: Data, boundary: String) -> Data {
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"screenshot\"; filename=\"screenshot.png\"\r\n")
        body.append("Content-Type: image/png\r\n\r\n")
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n")
        return body
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}
