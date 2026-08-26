import Foundation

// MARK: - Root Data Model
struct FinancialData: Codable {
    var transactions: [Transaction]
    var budgets: [String: [String: Double]]
    var exchangeRates: [ExchangeRate]
    var categories: [String]
    var settings: AppSettings

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
    let date: String
    let month: String
    let year: Int
    let description: String
    let amount: Double
    let currency: String
    let amountEUR: Double
    var category: String
    let source: String
    let type: String
    let balance: Double
    let importedAt: String
    var notes: String?

    var parsedDate: Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(for: date) != nil ? formatter.date(from: date) ?? Date() : Date()
    }

    var isIncome: Bool {
        return amountEUR > 0
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
}
