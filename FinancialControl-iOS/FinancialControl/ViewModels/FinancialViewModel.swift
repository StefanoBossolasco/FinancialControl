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
    private var walletListener: ListenerRegistration?
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
                    self.removeListeners()
                    self.data = .empty
                }
            }
        }
    }

    deinit {
        if let handle = authHandle { Auth.auth().removeStateDidChangeListener(handle) }
        txListener?.remove()
        walletListener?.remove()
    }

    private func removeListeners() {
        txListener?.remove()
        txListener = nil
        walletListener?.remove()
        walletListener = nil
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
        removeListeners()
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
    
    func syncData() async {
        // No-op for real-time Firebase DB
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

            // Load wallets
            let walletDicts = try await firebase.loadWallets()
            data.wallets = walletDicts.compactMap { decodeWallet($0) }

            // Set up real-time listeners
            setupTxListener()
            setupWalletListener()

            isLoading = false
            showToast("Dati caricati!")
            #if DEBUG
            DebugLaunch.afterLoad(self)
            #endif
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

    private func setupWalletListener() {
        walletListener?.remove()
        do {
            walletListener = try firebase.listenToWallets { [weak self] dicts in
                guard let self = self else { return }
                Task { @MainActor in
                    self.data.wallets = dicts.compactMap { self.decodeWallet($0) }
                }
            }
        } catch {
            print("Wallet listener setup failed: \(error)")
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
        if let rates = meta["exchangeRates"] as? [[String: Any]] {
            data.exchangeRates = rates.compactMap { r in
                guard let date = r["date"] as? String,
                      let eur = (r["eurSpent"] as? NSNumber)?.doubleValue,
                      let usd = (r["usdReceived"] as? NSNumber)?.doubleValue else { return nil }
                return ExchangeRate(date: date, eurSpent: eur, usdReceived: usd, rate: (r["rate"] as? NSNumber)?.doubleValue ?? 0)
            }
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
            notes: d["notes"] as? String,
            details: d["details"] as? String,
            walletId: (d["walletId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    private func decodeWallet(_ d: [String: Any]) -> Wallet? {
        guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
        return Wallet(
            id: id,
            name: name,
            amount: (d["amount"] as? NSNumber)?.doubleValue ?? 0,
            color: d["color"] as? String ?? Wallet.palette[0],
            startDate: d["startDate"] as? String,
            endDate: d["endDate"] as? String,
            notes: d["notes"] as? String,
            createdAt: d["createdAt"] as? String ?? ""
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
        if let details = tx.details { d["details"] = details }
        if let walletId = tx.walletId { d["walletId"] = walletId }
        return d
    }

    // MARK: - Transaction CRUD

    func addTransaction(description: String, amount: Double? = nil, currency: String = "EUR", amountEUR: Double, category: String, source: String, date: Date, notes: String?, walletId: String? = nil) {
        let dateStr = Transaction.dayFormatter.string(from: date)
        let monthStr = String(dateStr.prefix(7))

        let yearVal = Calendar.current.component(.year, from: date)
        let txId = "tx_ios_\(Int(Date().timeIntervalSince1970))_\(Int.random(in: 1000...9999))"

        let newTx = Transaction(
            id: txId,
            date: dateStr,
            month: monthStr,
            year: yearVal,
            description: description,
            amount: amount ?? amountEUR,
            currency: currency,
            amountEUR: amountEUR,
            category: category,
            source: source,
            type: amountEUR > 0 ? "Income" : "Expense",
            balance: 0,
            importedAt: ISO8601DateFormatter().string(from: Date()),
            notes: notes,
            walletId: walletId
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

    /// Saves the edited fields of an existing transaction; other fields written by the web app are left as they are
    func updateTransaction(_ tx: Transaction) {
        guard let idx = data.transactions.firstIndex(where: { $0.id == tx.id }) else { return }
        let backup = data.transactions[idx]
        data.transactions[idx] = tx

        let fields: [String: Any?] = [
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
            "notes": tx.notes ?? "",
            "walletId": tx.walletId
        ]
        Task {
            do {
                try await firebase.updateTransaction(id: tx.id, fields: fields)
                showToast("Transazione modificata!")
            } catch {
                if let i = data.transactions.firstIndex(where: { $0.id == tx.id }) { data.transactions[i] = backup }
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    func updateCategory(txId: String, category: String) {
        guard let idx = data.transactions.firstIndex(where: { $0.id == txId }) else { return }
        data.transactions[idx].category = category
        Task {
            try? await firebase.updateTransaction(id: txId, fields: ["category": category])
        }
    }

    // MARK: - Wallets

    var sortedWallets: [Wallet] {
        data.wallets.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func wallet(id: String?) -> Wallet? {
        guard let id = id else { return nil }
        return data.wallets.first { $0.id == id }
    }

    func walletStats(id: String) -> WalletStats? {
        guard let w = wallet(id: id) else { return nil }
        return WalletStats(wallet: w, txs: data.transactions.filter { $0.walletId == id })
    }

    /// Creates (id nil) or replaces a wallet, keeping createdAt. Returns the wallet id.
    @discardableResult
    func saveWallet(id: String?, name: String, amount: Double, color: String, startDate: String?, endDate: String?, notes: String?) -> String {
        let walletId = id ?? "w_" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36) + String(Int.random(in: 0..<1_679_616), radix: 36)
        let createdAt = wallet(id: walletId)?.createdAt.nilIfEmpty ?? ISO8601DateFormatter.withFractionalSeconds.string(from: Date())
        let w = Wallet(id: walletId, name: name, amount: (amount * 100).rounded() / 100, color: color,
                       startDate: startDate?.nilIfEmpty, endDate: endDate?.nilIfEmpty, notes: notes?.nilIfEmpty, createdAt: createdAt)

        var doc: [String: Any] = ["name": w.name, "amount": w.amount, "color": w.color, "createdAt": w.createdAt]
        if let v = w.startDate { doc["startDate"] = v }
        if let v = w.endDate { doc["endDate"] = v }
        if let v = w.notes { doc["notes"] = v }

        data.wallets.removeAll { $0.id == walletId }
        data.wallets.append(w)
        Task {
            do {
                try await firebase.saveWallet(doc, id: walletId)
                showToast("Wallet \"\(name)\" salvato")
            } catch {
                showToast("Errore: \(error.localizedDescription)")
            }
        }
        return walletId
    }

    func deleteWallet(id: String) {
        let assigned = data.transactions.filter { $0.walletId == id }.map(\.id)
        data.wallets.removeAll { $0.id == id }
        for i in data.transactions.indices where data.transactions[i].walletId == id {
            data.transactions[i].walletId = nil
        }
        Task {
            do {
                try await firebase.deleteWallet(id: id, assignedTxIds: assigned)
                showToast("Wallet eliminato")
            } catch {
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    /// Assigns (walletId) or unassigns (nil) the given transactions
    func assignWallet(txIds: Set<String>, walletId: String?) {
        guard !txIds.isEmpty else { return }
        for i in data.transactions.indices where txIds.contains(data.transactions[i].id) {
            data.transactions[i].walletId = walletId
        }
        let name = wallet(id: walletId)?.name
        Task {
            do {
                try await firebase.assignWallet(txIds: Array(txIds), walletId: walletId)
                showToast(name.map { "\(txIds.count) transazioni assegnate a \"\($0)\"" } ?? "\(txIds.count) transazioni rimosse dal wallet")
            } catch {
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Import

    /// Saves imported rows, skipping ids already stored (so existing rows and their wallet are never overwritten),
    /// and appends the matched EUR→USD exchanges to meta/main
    @discardableResult
    func importTransactions(_ txs: [Transaction], exchangePairs: [ExchangeInfo.Pair]) async -> Int {
        // Also keeps one copy of an id that appears in two files (e.g. EUR rows inside a Revolut USD export)
        var seen = Set(data.transactions.map(\.id))
        let added = txs.filter { seen.insert($0.id).inserted }
        do {
            try await firebase.saveTransactions(added.map { txToDict($0) })
            data.transactions.append(contentsOf: added)
            if !exchangePairs.isEmpty {
                let rates = exchangePairs.map { ExchangeRate(date: $0.date, eurSpent: $0.eur, usdReceived: $0.usd, rate: $0.rate) }
                try await firebase.addExchangeRates(rates.map {
                    ["date": $0.date, "eurSpent": $0.eurSpent, "usdReceived": $0.usdReceived, "rate": $0.rate]
                })
                data.exchangeRates.append(contentsOf: rates)
            }
            showToast("\(added.count) transazioni importate")
        } catch {
            showToast("Errore: \(error.localizedDescription)")
        }
        return added.count
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
                    categories: data.categories
                )
                showToast("Saldo iniziale aggiornato!")
            } catch {
                showToast("Errore: \(error.localizedDescription)")
            }
        }
    }

    /// Weighted average USD per EUR from the recorded exchanges, 1.16 when none (same fallback as the web app)
    var usdPerEur: Double {
        let eur = data.exchangeRates.reduce(0) { $0 + $1.eurSpent }
        let usd = data.exchangeRates.reduce(0) { $0 + $1.usdReceived }
        return eur > 0 && usd > 0 ? usd / eur : 1.16
    }

    // MARK: - Analytics helpers

    /// Per-category budget for a month: the month's own value, else the default (web Data.getAllBudgets)
    func allBudgets(yearMonth: String) -> [String: Double] {
        let def = data.budgets["default"] ?? [:]
        let month = data.budgets[yearMonth] ?? [:]
        var result: [String: Double] = [:]
        for cat in data.categories { result[cat] = month[cat] ?? def[cat] ?? 0 }
        return result
    }

    /// Expenses per category in a month (web Data.getCategoryTotals)
    func categoryTotals(yearMonth: String) -> [String: Double] {
        var totals: [String: Double] = [:]
        for t in data.transactions where t.month == yearMonth && t.category != "__exchange__" && t.amountEUR < 0 {
            totals[t.category, default: 0] += abs(t.amountEUR)
        }
        return totals
    }

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

extension String {
    var nilIfEmpty: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

extension ISO8601DateFormatter {
    /// Matches JavaScript's Date.toISOString() ("2026-10-28T09:15:00.000Z")
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
