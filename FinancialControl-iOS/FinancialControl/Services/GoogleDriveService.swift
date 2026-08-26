import Foundation

class GoogleDriveService {
    let webAppUrl: String
    let token: String

    init(webAppUrl: String, token: String) {
        self.webAppUrl = webAppUrl
        self.token = token
    }

    enum DriveError: Error {
        case invalidURL
        case networkError(String)
        case apiError(String)
    }

    func fetch() async throws -> FinancialData {
        guard var urlComponents = URLComponents(string: webAppUrl) else {
            throw DriveError.invalidURL
        }
        
        var queryItems = [URLQueryItem(name: "action", value: "read")]
        if !token.isEmpty {
            queryItems.append(URLQueryItem(name: "token", value: token))
        }
        urlComponents.queryItems = queryItems
        
        guard let url = urlComponents.url else {
            throw DriveError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw DriveError.networkError("Failed to fetch from Google Drive")
        }
        
        // Handle possible error payload
        if let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any], let err = json["error"] as? String {
            throw DriveError.apiError(err)
        }
        
        return try JSONDecoder().decode(FinancialData.self, from: data)
    }

    func push(financialData: FinancialData) async throws {
        guard let url = URL(string: webAppUrl) else {
            throw DriveError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "write",
            "token": token,
            "data": try JSONSerialization.jsonObject(with: try JSONEncoder().encode(financialData), options: [])
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw DriveError.networkError("Failed to push to Google Drive")
        }
        
        if let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any], let err = json["error"] as? String {
            throw DriveError.apiError(err)
        }
    }
}
