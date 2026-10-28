import SwiftUI

/// New transaction, or edit of an existing one when `editing` is set.
/// Field values match the web app: type "Expense"/"Income", sources revolut_eur/revolut_usd/intesa/satispay/other.
struct AddExpenseSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var viewModel: FinancialViewModel

    var editing: Transaction? = nil
    var presetWalletId: String? = nil

    @State private var description: String = ""
    @State private var amountText: String = ""
    @State private var currency: String = "EUR"
    @State private var category: String = "Altro"
    @State private var source: String = "revolut_eur"
    @State private var isIncome: Bool = false
    @State private var date: Date = Date()
    @State private var notes: String = ""
    @State private var walletId: String = ""
    @State private var confirmDelete = false

    static let sources: [(String, String)] = [
        ("revolut_eur", "Revolut EUR"), ("revolut_usd", "Revolut USD"), ("intesa", "Intesa San Paolo"),
        ("satispay", "Satispay"), ("other", "Altro / Contanti")
    ]

    private var parsedAmount: Double? {
        guard let v = Double(amountText.replacingOccurrences(of: ",", with: ".")), v > 0 else { return nil }
        return v
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tipo", selection: $isIncome) {
                        Text("Spesa").tag(false)
                        Text("Entrata").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())

                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(isIncome ? "+" : "−")
                            .foregroundColor(isIncome ? Theme.success : Theme.text2)
                        TextField("0,00", text: $amountText)
                            .keyboardType(.decimalPad)
                        Picker("", selection: $currency) {
                            Text("€").tag("EUR")
                            Text("$").tag("USD")
                        }
                        .labelsHidden()
                        .fixedSize()
                    }
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 0, trailing: 4))
                }

                Section("Dettagli") {
                    TextField("Descrizione (es. Spesa supermercato)", text: $description)
                    DatePicker("Data", selection: $date, displayedComponents: .date)
                    Picker("Categoria", selection: $category) {
                        ForEach(categoryOptions, id: \.self) { cat in
                            Label(cat, systemImage: CategoryStyle.icon(cat)).tag(cat)
                        }
                    }
                    Picker("Conto", selection: $source) {
                        ForEach(sourceOptions, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }

                Section("Wallet") {
                    Picker("Wallet", selection: $walletId) {
                        Text("Nessun wallet").tag("")
                        ForEach(viewModel.sortedWallets) { w in
                            Text(w.name).tag(w.id)
                        }
                    }
                }

                Section("Note") {
                    TextField("Note o promemoria…", text: $notes, axis: .vertical)
                        .lineLimit(1...4)
                }

                if let details = editing?.details, !details.isEmpty {
                    Section("Dettagli banca") {
                        Text(details).font(.footnote).foregroundColor(Theme.text2).textSelection(.enabled)
                    }
                }

                if editing != nil {
                    Section {
                        Button("Elimina transazione", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(editing == nil ? "Nuova transazione" : "Modifica")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salva") { save() }
                        .fontWeight(.bold)
                        .disabled(description.trimmingCharacters(in: .whitespaces).isEmpty || parsedAmount == nil)
                }
            }
            .confirmationDialog("Eliminare questa transazione?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Elimina", role: .destructive) {
                    if let tx = editing { viewModel.deleteTransaction(id: tx.id) }
                    dismiss()
                }
            }
            .onAppear(perform: load)
        }
        .tint(Theme.accent)
    }

    /// Keeps a category or source the web app wrote even if it's not in the lists
    private var categoryOptions: [String] {
        let cats = viewModel.data.categories
        return cats.contains(category) ? cats : cats + [category]
    }

    private var sourceOptions: [(String, String)] {
        Self.sources.contains { $0.0 == source } ? Self.sources : Self.sources + [(source, source.isEmpty ? "—" : source)]
    }

    private func load() {
        if let tx = editing {
            description = tx.description
            amountText = String(format: "%.2f", abs(tx.amount != 0 ? tx.amount : tx.amountEUR))
            currency = tx.currency
            category = tx.category
            source = tx.source
            isIncome = tx.amountEUR > 0
            date = tx.parsedDate
            notes = tx.notes ?? ""
            walletId = tx.walletId ?? ""
        } else {
            walletId = presetWalletId ?? ""
            category = viewModel.data.categories.contains("Altro") ? "Altro" : (viewModel.data.categories.first ?? "Altro")
        }
    }

    private func save() {
        guard let raw = parsedAmount else { return }
        let rate = currency == "USD" ? viewModel.usdPerEur : 1
        let amtEUR = currency == "EUR" ? raw : (raw / rate * 100).rounded() / 100
        let signedEUR = isIncome ? abs(amtEUR) : -abs(amtEUR)
        let signedRaw = isIncome ? abs(raw) : -abs(raw)
        let desc = description.trimmingCharacters(in: .whitespaces)
        let wid = walletId.isEmpty ? nil : walletId

        if var tx = editing {
            let dateStr = Transaction.dayFormatter.string(from: date)
            tx.date = dateStr
            tx.month = String(dateStr.prefix(7))
            tx.year = Int(dateStr.prefix(4)) ?? tx.year
            tx.description = desc
            tx.amount = signedRaw
            tx.currency = currency
            tx.amountEUR = signedEUR
            tx.category = category
            tx.source = source
            tx.type = isIncome ? "Income" : "Expense"
            tx.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            tx.walletId = wid
            viewModel.updateTransaction(tx)
        } else {
            viewModel.addTransaction(
                description: desc,
                amount: signedRaw,
                currency: currency,
                amountEUR: signedEUR,
                category: category,
                source: source,
                date: date,
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                walletId: wid
            )
        }
        dismiss()
    }
}
