import Foundation
import Combine
import SwiftUI
import FirebaseAuth
import FirebaseFirestore

@MainActor
class FinancialViewModel: ObservableObject {

    // MARK: - Published state
    @Published var data: FinancialData = .empty
    @Published var isLoading: Bool = false
    @Published var isSyncing: Bool = false
    @Published var errorMessage: String? = nil
    @Published var toastMessage: String? = nil

    // MARK: - Auth state
    @Published var currentUser: User? = nil
    @Published var isLoggedIn: Bool = false

    // MARK: - Filters
    @Published var selectedYear: Int  = Calendar.current.component(.year,  from: Date())
    @Published var selectedMonth: Int = Calendar.current.component(.month, from: Date())

    private let firebase = FirebaseService.shared
    private var txListener: ListenerRegistration?
    private var authHandle: AuthStateDidChangeListenerHandle?

    // MARK: - Init

    init() {
        setupAuthListener()
    }

    private func setupAuthListener() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            guard let self = self else { return }
            Task { @MainActor in
                self.currentUser = user
                self.isLoggedIn = user != nil
                if let user = user {
                    await self.loadUserData(uid: user.uid)
                } else {
                    self.txListener?.remove()
                    self.txListener = nil
                    self.data = .empty
                }
            }
        }
    }

    deinit {
        if let handle = authHandle { Auth.auth().removeStateDidChangeListener(handle) }
        txListener?.remove()
    }

    // MARK: - Auth actions

    func login(email: String, password: String) async throws {
        try await firebase.signIn(email: email, password: password)
        // Auth listener will fire and call loadUserData
    }

    func signup(email: String, password: String) async throws {
        try await firebase.signUp(email: email, password: password)
    }

    func logout() throws {
        txListener?.remove()
        txListener = nil
        try firebase.signOut()
    }

    func changePassword(currentPw: String, newPw: String) async throws {
        try await firebase.changePassword(currentPw: currentPw, newPw: newPw)
        showToast("Password aggiornata!")
    }

    func sendPasswordReset(email: String) async throws {
        try await firebase.sendPasswordReset(email: email)
    }

    // MARK: - Load data from Firestore

    func loadInitialData() {
        // Auth listener handles loading — nothing to do here manually
    }

    private func loadUserData(uid: String) async {
        isLoading = true
        errorMessage = nil

        do {
            // Load meta (settings, categories, exchange rates)
            let meta = try await firebase.loadMeta()
            applyMeta(meta)

            // Load transactions
            let txDicts = try await firebase.loadTransactions()
            data.transactions = txDicts.compactMap { decodeTransaction($0) }

            // Load budgets
            let budgets = try await firebase.loadBudgets()
            var convertedBudgets: [String: [String: Double]] = [:]
            budgets.forEach { convertedBudgets[$0.key] = $0.value }
            data.budgets = convertedBudgets

            // Set up real-time listener
            setupTxListener()

            isLoading = false
            showToast("Dati caricati!")
        } catch {
            isLoading = false
            errorMessage = "Errore caricamento: \(error.localizedDescription)"
        }
    }

    private func setupTxListener() {
        txListener?.remove()
        do {
            txListener = try firebase.listenToTransactions { [weak self] txDicts in
                guard let self = self else { return }
                Task { @MainActor in
                    self.data.transactions = txDicts.compactMap { self.decodeTransaction($0) }
                }
            }
        } catch {
            print("Listener setup failed: \(error)")
        }
    }

    // MARK: - Helpers: decode from Firestore dict

    private func applyMeta(_ meta: [String: Any]) {
        if let settings = meta["settings"] as? [String: Any] {
            if let bal = settings["initialBalance"] as? Double {
                data.settings.initialBalance = bal
            }
            if let cur = settings["currency"] as? String {
                data.settings.currency = cur
            }
        }
        if let cats = meta["categories"] as? [String] {
            data.categories = cats
        }
    }

    private func decodeTransaction(_ d: [String: Any]) -> Transaction? {
        guard
            let id = d["id"] as? String,
            let date = d["date"] as? String,
            let month = d["month"] as? String,
            let description = d["description"] as? String,
            let amountEUR = d["amountEUR"] as? Double
        else { return nil }

        let year = d["year"] as? Int ?? Int(month.prefix(4)) ?? Calendar.current.component(.year, from: Date())

        return Transaction(
            id: id,
            date: date,
            month: month,
            year: year,
            description: description,
            amount: d["amount"] as? Double ?? amountEUR,
            currency: d["currency"] as? String ?? "EUR",
            amountEUR: amountEUR,
            category: d["category"] as? String ?? "Altro",
            source: d["source"] as? String ?? "",
            type: d["type"] as? String ?? (amountEUR > 0 ? "income" : "expense"),
            balance: d["balance"] as? Double ?? 0,
            importedAt: d["importedAt"] as? String ?? "",
            notes: d["notes"] as? String
        )
    }

    private func txToDict(_ tx: Transaction) -> [String: Any] {
        var d: [String: Any] = [
            "id": tx.id,
            "date": tx.date,
            "month": tx.month,
            "year": tx.year,
            "description": tx.description,
            "amount": tx.amount,
            "currency": tx.currency,
            "amountEUR": tx.amountEUR,
            "category": tx.category,
            "source": tx.source,
            "type": tx.type,
            "balance": tx.balance,
            "importedAt": tx.importedAt
        ]
        if let notes = tx.notes { d["notes"] = notes }
        return d
    }

    // MARK: - Transaction CRUD

    func addTransaction(description: String, amountEUR: Double, category: String, source: String, date: Date, notes: String?) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy-MM"
        let monthStr = monthFormatter.string(from: date)

        let yearVal = Calendar.current.component(.year, from: date)
        let txId = "tx_ios_\(Int(Date().timeIntervalSince1970))_\(Int.random(in: 1000...9999))"

        let newTx = Transaction(
            id: txId,
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

        // Optimistic update
        data.transactions.insert(newTx, at: 0)

        Task {
            do {
                var dict = txToDict(newTx)
                dict.removeValue(forKey: "id")
                try await firebase.saveTransaction(dict, id: txId)
                showToast("Transazione aggiunta!")
            } catch {
                // Rollback
                data.transactions.removeAll { $0.id == txId }
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    func deleteTransaction(id: String) {
        // Optimistic update
        let backup = data.transactions.first { $0.id == id }
        data.transactions.removeAll { $0.id == id }

        Task {
            do {
                try await firebase.deleteTransaction(id: id)
                showToast("Transazione eliminata")
            } catch {
                // Rollback
                if let tx = backup { data.transactions.insert(tx, at: 0) }
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Budget

    func updateBudget(category: String, amount: Double, yearMonth: String = "default") {
        if data.budgets[yearMonth] == nil { data.budgets[yearMonth] = [:] }
        data.budgets[yearMonth]?[category] = amount

        Task {
            do {
                let budget = data.budgets[yearMonth] ?? [:]
                try await firebase.saveBudget(key: yearMonth, budget: budget)
            } catch {
                showToast("Errore salvataggio budget")
            }
        }
    }

    // MARK: - Settings

    func updateInitialBalance(_ value: Double) {
        data.settings.initialBalance = value
        Task {
            do {
                try await firebase.saveMeta(
                    settings: ["initialBalance": value, "currency": data.settings.currency ?? "EUR"],
                    categories: data.categories,
                    exchangeRates: []
                )
                showToast("Saldo iniziale aggiornato!")
            } catch {
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Analytics helpers

    var availableYears: [Int] {
        let years = Array(Set(data.transactions.map { $0.year })).sorted(by: >)
        return years.isEmpty ? [Calendar.current.component(.year, from: Date())] : years
    }

    func monthlyTxs(year: Int, month: Int) -> [Transaction] {
        let monthStr = String(format: "%04d-%02d", year, month)
        return data.transactions.filter { $0.month == monthStr && $0.category != "__exchange__" }
    }

    func monthlyIncome(year: Int, month: Int) -> Double {
        monthlyTxs(year: year, month: month).filter { $0.amountEUR > 0 }.reduce(0) { $0 + $1.amountEUR }
    }

    func monthlyExpenses(year: Int, month: Int) -> Double {
        monthlyTxs(year: year, month: month).filter { $0.amountEUR < 0 }.reduce(0) { $0 + abs($1.amountEUR) }
    }

    var totalCurrentBalance: Double {
        let initial = data.settings.initialBalance ?? 0
        let sum = data.transactions.filter { $0.category != "__exchange__" }.reduce(0) { $0 + $1.amountEUR }
        return initial + sum
    }

    // MARK: - Toast

    func showToast(_ text: String) {
        withAnimation { self.toastMessage = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            withAnimation { if self?.toastMessage == text { self?.toastMessage = nil } }
        }
    }
}
