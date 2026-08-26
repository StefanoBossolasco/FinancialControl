import Foundation
import Combine
import SwiftUI

@MainActor
class FinancialViewModel: ObservableObject {
    @Published var data: FinancialData = .empty
    @Published var currentSha: String = ""
    @Published var isLoading: Bool = false
    @Published var isSyncing: Bool = false
    @Published var errorMessage: String? = nil
    @Published var toastMessage: String? = nil

    // GitHub Config
    @Published var owner: String = "StefanoBossolasco"
    @Published var repo: String = "FinancialControl"
    @Published var branch: String = "main"
    @Published var path: String = "data.json"
    @Published var patToken: String = ""

    // Google Drive Config
    @Published var googleDriveUrl: String = "https://script.google.com/macros/s/AKfycbxAbQvmLE5zdVUroNj23cIaGHt1rUDkWOjyhxKLoK-p4DBvIgN_2rDsb0h_8evGJIHdWQ/exec"
    @Published var googleDriveToken: String = "AKfycbxAbQvmLE5zdVUroNj23cIaGHt1rUDkWOjyhxKLoK-p4DBvIgN_2rDsb0h_8evGJIHdWQ"

    // Filters
    @Published var selectedYear: Int = Calendar.current.component(.year, from: Date())
    @Published var selectedMonth: Int = Calendar.current.component(.month, from: Date())

    private let cacheKey = "FinancialControl_CachedData"

    init() {
        self.patToken = KeychainService.load(key: "github_pat") ?? ""
        self.owner = UserDefaults.standard.string(forKey: "gh_owner") ?? "StefanoBossolasco"
        self.repo = UserDefaults.standard.string(forKey: "gh_repo") ?? "FinancialControl"

        self.googleDriveUrl = UserDefaults.standard.string(forKey: "gd_url") ?? ""
        self.googleDriveToken = KeychainService.load(key: "gd_token") ?? ""
    }

    func loadInitialData() {
        loadFromCache()
        if !patToken.isEmpty || !googleDriveUrl.isEmpty {
            Task {
                await syncData()
            }
        }
    }

    func saveGitHubConfig(owner: String, repo: String, branch: String, path: String, patToken: String) {
        self.owner = owner
        self.repo = repo
        self.branch = branch
        self.path = path
        self.patToken = patToken

        UserDefaults.standard.set(owner, forKey: "gh_owner")
        UserDefaults.standard.set(repo, forKey: "gh_repo")
        KeychainService.save(key: "github_pat", data: patToken)

        showToast("Configurazione GitHub salvata!")
        Task { await syncData() }
    }

    func saveGoogleDriveConfig(url: String, token: String) {
        self.googleDriveUrl = url
        self.googleDriveToken = token

        UserDefaults.standard.set(url, forKey: "gd_url")
        KeychainService.save(key: "gd_token", data: token)

        showToast("Configurazione Drive salvata!")
        Task { await syncData() }
    }

    // MARK: - Local Cache
    func loadFromCache() {
        guard let savedData = UserDefaults.standard.data(forKey: cacheKey),
              let decoded = try? JSONDecoder().decode(FinancialData.self, from: savedData) else {
            return
        }
        self.data = decoded
    }

    func saveToCache() {
        if let encoded = try? JSONEncoder().encode(data) {
            UserDefaults.standard.set(encoded, forKey: cacheKey)
        }
    }

    // MARK: - Cloud Sync
    func syncData() async {
        if !googleDriveUrl.isEmpty {
            await syncFromGoogleDrive()
        } else if !patToken.isEmpty {
            await syncFromGitHub()
        }
    }

    func pushData(message: String = "Update from iOS App") async {
        if !googleDriveUrl.isEmpty {
            await pushToGoogleDrive()
        } else if !patToken.isEmpty {
            await pushToGitHub(message: message)
        } else {
            saveToCache()
        }
    }

    private func syncFromGoogleDrive() async {
        isLoading = true
        errorMessage = nil
        let service = GoogleDriveService(webAppUrl: googleDriveUrl, token: googleDriveToken)
        do {
            let fetchedData = try await service.fetch()
            self.data = fetchedData
            self.saveToCache()
            self.isLoading = false
            self.showToast("Dati sincronizzati da Google Drive!")
        } catch {
            self.isLoading = false
            self.errorMessage = "Errore Sync Drive: \(error.localizedDescription)"
        }
    }

    private func pushToGoogleDrive() async {
        isSyncing = true
        let service = GoogleDriveService(webAppUrl: googleDriveUrl, token: googleDriveToken)
        do {
            try await service.push(financialData: data)
            self.saveToCache()
            self.isSyncing = false
            self.showToast("Sincronizzato su Google Drive!")
        } catch {
            self.isSyncing = false
            self.showToast("Sync Drive fallito: salvato in locale")
        }
    }

    private func syncFromGitHub() async {
        isLoading = true
        errorMessage = nil

        let service = GitHubService(owner: owner, repo: repo, branch: branch, path: path, token: patToken)
        do {
            let (fetchedData, sha) = try await service.fetch()
            self.data = fetchedData
            self.currentSha = sha
            self.saveToCache()
            self.isLoading = false
            self.showToast("Dati sincronizzati da GitHub!")
        } catch {
            self.isLoading = false
            self.errorMessage = "Errore Sync GitHub: \(error.localizedDescription)"
        }
    }

    private func pushToGitHub(message: String) async {
        isSyncing = true

        let service = GitHubService(owner: owner, repo: repo, branch: branch, path: path, token: patToken)
        do {
            let newSha = try await service.push(financialData: data, sha: currentSha, message: message)
            self.currentSha = newSha
            self.saveToCache()
            self.isSyncing = false
            self.showToast("Sincronizzato su GitHub!")
        } catch {
            self.isSyncing = false
            self.showToast("Sync GitHub fallito: salvato in locale")
        }
    }

    // MARK: - Actions
    func addTransaction(description: String, amountEUR: Double, category: String, source: String, date: Date, notes: String?) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        let monthStr = monthFormatter.string(from: date)

        let yearVal = Calendar.current.component(.year, from: date)

        let newTx = Transaction(
            id: "tx_ios_" + String(Int(Date().timeIntervalSince1970)) + "_" + String(Int.random(in: 1000...9999)),
            date: dateStr,
            month: monthStr,
            year: yearVal,
            description: description,
            amount: amountEUR,
            currency: "EUR",
            amountEUR: amountEUR,
            category: category,
            source: source,
            type: amountEUR > 0 ? "income" : "expense",
            balance: 0,
            importedAt: ISO8601DateFormatter().string(from: Date()),
            notes: notes
        )

        data.transactions.insert(newTx, at: 0)
        saveToCache()

        Task {
            await pushData(message: "Add transaction from iOS: \(description)")
        }
    }

    func deleteTransaction(id: String) {
        data.transactions.removeAll { $0.id == id }
        saveToCache()
        Task {
            await pushData(message: "Delete transaction from iOS")
        }
    }

    func updateBudget(category: String, amount: Double, yearMonth: String = "default") {
        if data.budgets[yearMonth] == nil {
            data.budgets[yearMonth] = [:]
        }
        data.budgets[yearMonth]?[category] = amount
        saveToCache()
        Task {
            await pushData(message: "Update budget for \(category) from iOS")
        }
    }

    func showToast(_ text: String) {
        withAnimation {
            self.toastMessage = text
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            withAnimation {
                if self.toastMessage == text {
                    self.toastMessage = nil
                }
            }
        }
    }

    // MARK: - Computed Analytics Helpers
    var availableYears: [Int] {
        let years = Array(Set(data.transactions.map { $0.year })).sorted(by: >)
        return years.isEmpty ? [Calendar.current.component(.year, from: Date())] : years
    }

    func monthlyTxs(year: Int, month: Int) -> [Transaction] {
        let monthStr = String(format: "%04d-%02d", year, month)
        return data.transactions.filter { $0.month == monthStr && $0.category != "__exchange__" }
    }

    func monthlyIncome(year: Int, month: Int) -> Double {
        return monthlyTxs(year: year, month: month).filter { $0.amountEUR > 0 }.reduce(0) { $0 + $1.amountEUR }
    }

    func monthlyExpenses(year: Int, month: Int) -> Double {
        return monthlyTxs(year: year, month: month).filter { $0.amountEUR < 0 }.reduce(0) { $0 + abs($1.amountEUR) }
    }

    var totalCurrentBalance: Double {
        let initial = data.settings.initialBalance ?? 0
        let sum = data.transactions.filter { $0.category != "__exchange__" }.reduce(0) { $0 + $1.amountEUR }
        return initial + sum
    }
}
