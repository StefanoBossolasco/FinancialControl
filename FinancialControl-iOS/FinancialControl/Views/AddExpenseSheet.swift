import SwiftUI

struct AddExpenseSheet: View {
    @Environment(\.presentationMode) var presentationMode
    @EnvironmentObject var viewModel: FinancialViewModel

    @State private var description: String = ""
    @State private var amountText: String = ""
    @State private var category: String = "Altro"
    @State private var source: String = "manual"
    @State private var isIncome: Bool = false
    @State private var date: Date = Date()
    @State private var notes: String = ""

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Dettagli Operazione")) {
                    Picker("Tipo", selection: $isIncome) {
                        Text("Spesa (Uscita)").tag(false)
                        Text("Entrata (Guadagno)").tag(true)
                    }
                    .pickerStyle(.segmented)

                    TextField("Descrizione (es. Spesa supermercato)", text: $description)

                    HStack {
                        Text("Importo (€)")
                        Spacer()
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }

                    DatePicker("Data", selection: $date, displayedComponents: .date)
                }

                Section(header: Text("Categoria & Fonte")) {
                    Picker("Categoria", selection: $category) {
                        ForEach(viewModel.data.categories, id: \.self) { cat in
                            Text(cat).tag(cat)
                        }
                    }

                    Picker("Conto / Fonte", selection: $source) {
                        Text("Revolut EUR").tag("revolut_eur")
                        Text("Intesa Sanpaolo").tag("intesa_eur")
                        Text("Revolut USD").tag("revolut_usd")
                        Text("Manuale / Altro").tag("manual")
                    }
                }

                Section(header: Text("Note Opzionali")) {
                    TextField("Note o promemoria…", text: $notes)
                }
            }
            .navigationTitle("Nuova Transazione")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salva") {
                        saveTransaction()
                    }
                    .disabled(description.trimmingCharacters(in: .whitespaces).isEmpty || Double(amountText.replacingOccurrences(of: ",", with: ".")) == nil)
                }
            }
        }
    }

    private func saveTransaction() {
        guard let parsedAmt = Double(amountText.replacingOccurrences(of: ",", with: ".")) else { return }
        let finalAmt = isIncome ? abs(parsedAmt) : -abs(parsedAmt)

        viewModel.addTransaction(
            description: description.trimmingCharacters(in: .whitespaces),
            amountEUR: finalAmt,
            category: category,
            source: source,
            date: date,
            notes: notes.isEmpty ? nil : notes
        )

        presentationMode.wrappedValue.dismiss()
    }
}
