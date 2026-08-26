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

    // Config
    @Published var owner: String = "StefanoBossolasco"
    @Published var repo: String = "FinancialControl"
    @Published var branch: String = "main"
    @Published var path: String = "data.json"
    @Published var patToken: String = ""

    // Filters
    @Published var selectedYear: Int = Calendar.current.component(.year, from: Date())
    @Published var selectedMonth: Int = Calendar.current.component(.month, from: Date())

    private let cacheKey = "FinancialControl_CachedData"

    init() {
        self.patToken = KeychainService.load(key: "github_pat") ?? ""
        self.owner = UserDefaults.standard.string(forKey: "gh_owner") ?? "StefanoBossolasco"
        self.repo = UserDefaults.standard.string(forKey: "gh_repo") ?? "FinancialControl"
    }

    func loadInitialData() {
        loadFromCache()
        if !patToken.isEmpty {
            Task {
                await syncFromGitHub()
            }
        }
    }

    func saveConfig(owner: String, repo: String, branch: String, path: String, patToken: String) {
        self.owner = owner
        self.repo = repo
        self.branch = branch
        self.path = path
        self.patToken = patToken

        UserDefaults.standard.set(owner, forKey: "gh_owner")
        UserDefaults.standard.set(repo, forKey: "gh_repo")
        KeychainService.save(key: "github_pat", data: patToken)

        showToast("Configurazione salvata!")
        Task {
            await syncFromGitHub()
        }
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

    // MARK: - GitHub Sync
    func syncFromGitHub() async {
        guard !patToken.isEmpty else { return }
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
            self.errorMessage = "Errore Sync: \(error.localizedDescription)"
        }
    }

    func pushToGitHub(message: String = "Update from iOS App") async {
        guard !patToken.isEmpty else {
            saveToCache()
            return
        }
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
            self.showToast("Sync fallito: salvato in locale")
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
            await pushToGitHub(message: "Add transaction from iOS: \(description)")
        }
    }

    func deleteTransaction(id: String) {
        data.transactions.removeAll { $0.id == id }
        saveToCache()
        Task {
            await pushToGitHub(message: "Delete transaction from iOS")
        }
    }

    func updateBudget(category: String, amount: Double, yearMonth: String = "default") {
        if data.budgets[yearMonth] == nil {
            data.budgets[yearMonth] = [:]
        }
        data.budgets[yearMonth]?[category] = amount
        saveToCache()
        Task {
            await pushToGitHub(message: "Update budget for \(category) from iOS")
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
