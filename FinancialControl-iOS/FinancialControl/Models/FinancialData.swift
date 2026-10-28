import Foundation

// MARK: - Root Data Model
struct FinancialData: Codable {
    var transactions: [Transaction]
    var budgets: [String: [String: Double]]
    var exchangeRates: [ExchangeRate]
    var categories: [String]
    var settings: AppSettings
    var wallets: [Wallet] = []

    static var empty: FinancialData {
        FinancialData(
            transactions: [],
            budgets: ["default": [:]],
            exchangeRates: [],
            categories: [
                "Affitto & Casa", "Spesa Alimentare", "Ristoranti & Bar",
                "Trasporti & Mobilità", "Viaggi & Vacanze", "Abbigliamento & Shopping",
                "Salute & Farmacia", "Sport & Fitness", "Streaming & Abbonamenti",
                "Utenze & Domiciliazioni", "Imposte & Tasse", "Commissioni Bancarie",
                "Intrattenimento", "Trasferimenti", "Entrate", "Altro"
            ],
            settings: AppSettings(initialBalance: 0)
        )
    }
}

// MARK: - Transaction
struct Transaction: Codable, Identifiable, Hashable {
    let id: String
    var date: String
    var month: String
    var year: Int
    var description: String
    var amount: Double
    var currency: String
    var amountEUR: Double
    var category: String
    var source: String
    var type: String
    let balance: Double
    let importedAt: String
    var notes: String?
    /// Bank detail text (Intesa "Dettagli" column, Satispay "type · @handle")
    var details: String? = nil
    /// Optional reference to users/{uid}/wallets/{walletId}
    var walletId: String? = nil

    var parsedDate: Date {
        Transaction.dayFormatter.date(from: date) ?? Date()
    }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var isIncome: Bool {
        return amountEUR > 0
    }
}

// MARK: - Wallet
/// users/{uid}/wallets/{id}: { name, amount, color, startDate?, endDate?, notes?, createdAt }
struct Wallet: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var amount: Double
    var color: String
    var startDate: String?
    var endDate: String?
    var notes: String?
    var createdAt: String

    static let palette = ["#0a84ff", "#30d158", "#ff9f0a", "#ff453a", "#bf5af2", "#64d2ff", "#ff375f", "#ffd60a"]
}

enum WalletStatus {
    case positive, zero, negative
}

struct WalletStats {
    let wallet: Wallet
    let txs: [Transaction]
    let allocated: Double
    let spent: Double
    let credits: Double
    var available: Double { allocated + credits }
    var remaining: Double { available - spent }
    /// nil when nothing is available but something was spent (web shows "—")
    var pctUsed: Double? {
        if available > 0 { return spent / available * 100 }
        return spent > 0 ? nil : 0
    }
    let byCategory: [String: Double]
    var status: WalletStatus {
        remaining > 0.005 ? .positive : remaining < -0.005 ? .negative : .zero
    }

    init(wallet: Wallet, txs: [Transaction]) {
        self.wallet = wallet
        self.txs = txs.sorted { $0.date > $1.date }
        allocated = wallet.amount
        spent = txs.filter { $0.amountEUR < 0 }.reduce(0) { $0 + abs($1.amountEUR) }
        credits = txs.filter { $0.amountEUR > 0 }.reduce(0) { $0 + $1.amountEUR }
        var cats: [String: Double] = [:]
        txs.filter { $0.amountEUR < 0 }.forEach { cats[$0.category, default: 0] += abs($0.amountEUR) }
        byCategory = cats
    }
}

// MARK: - Exchange Rate
struct ExchangeRate: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let eurSpent: Double
    let usdReceived: Double
    let rate: Double
}

// MARK: - App Settings
struct AppSettings: Codable, Hashable {
    var initialBalance: Double?
    var currency: String?
}
