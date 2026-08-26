import Foundation

actor GitHubService {
    let owner: String
    let repo: String
    let branch: String
    let path: String
    let token: String

    init(owner: String, repo: String, branch: String = "main", path: String = "data.json", token: String) {
        self.owner = owner
        self.repo = repo
        self.branch = branch
        self.path = path
        self.token = token
    }

    struct GitHubFileResponse: Codable {
        let content: String
        let sha: String
    }

    /// Fetches data.json from GitHub REST API
    func fetch() async throws -> (data: FinancialData, sha: String) {
        guard let url = URL(string: "https://api.github.com/repos/\(owner)/\(repo)/contents/\(path)?ref=\(branch)") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("token \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpStatus = response as? HTTPURLResponse, httpStatus.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let fileResponse = try JSONDecoder().decode(GitHubFileResponse.self, from: data)
        let cleanedContent = fileResponse.content.replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\r", with: "")

        guard let decodedData = Data(base64Encoded: cleanedContent) else {
            throw URLError(.cannotDecodeContentData)
        }

        let financialData = try JSONDecoder().decode(FinancialData.self, from: decodedData)
        return (financialData, fileResponse.sha)
    }

    /// Pushes updated FinancialData to GitHub
    func push(financialData: FinancialData, sha: String, message: String) async throws -> String {
        guard let url = URL(string: "https://api.github.com/repos/\(owner)/\(repo)/contents/\(path)") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("token \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let jsonData = try encoder.encode(financialData)
        let base64Content = jsonData.base64EncodedString()

        let payload: [String: String] = [
            "message": message,
            "content": base64Content,
            "sha": sha,
            "branch": branch
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpStatus = response as? HTTPURLResponse, (200...299).contains(httpStatus.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let fileResponse = try JSONDecoder().decode(GitHubFileResponse.self, from: data)
        return fileResponse.sha
    }
}
