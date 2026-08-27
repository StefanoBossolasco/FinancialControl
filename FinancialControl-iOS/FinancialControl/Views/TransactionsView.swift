import SwiftUI

struct TransactionsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var searchText = ""
    @State private var selectedCategory = "Tutte"
    
    // Filtri Avanzati
    @State private var showFilterSheet = false
    @State private var minPrice: String = ""
    @State private var maxPrice: String = ""
    @State private var startDate: Date = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    @State private var endDate: Date = Date()
    @State private var useDateRange = false
    
    // Paginazione UI
    @State private var visibleLimit: Int = 20
    
    var filteredTransactions: [Transaction] {
        let allTxs = viewModel.data.transactions.sorted(by: { $0.date > $1.date })
        return allTxs.filter { tx in
            let matchesSearch = searchText.isEmpty || tx.description.localizedCaseInsensitiveContains(searchText)
            let matchesCat = selectedCategory == "Tutte" || tx.category == selectedCategory
            
            var matchesPrice = true
            let price = abs(tx.amountEUR)
            if let min = Double(minPrice), price < min { matchesPrice = false }
            if let max = Double(maxPrice), price > max { matchesPrice = false }
            
            var matchesDate = true
            if useDateRange {
                let txDate = tx.parsedDate
                if txDate < Calendar.current.startOfDay(for: startDate) || txDate > Calendar.current.date(byAdding: .day, value: 1, to: endDate)! {
                    matchesDate = false
                }
            }
            
            return matchesSearch && matchesCat && matchesPrice && matchesDate
        }
    }
    
    var paginatedTransactions: [Transaction] {
        Array(filteredTransactions.prefix(visibleLimit))
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Category Filter Scroll Pill Bar
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterPill(title: "Tutte", isSelected: selectedCategory == "Tutte") {
                            selectedCategory = "Tutte"
                            visibleLimit = 20
                        }
                        ForEach(viewModel.data.categories, id: \.self) { cat in
                            FilterPill(title: cat, isSelected: selectedCategory == cat) {
                                selectedCategory = cat
                                visibleLimit = 20
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 8)
                .background(Color(.systemBackground))

                // List
                List {
                    ForEach(paginatedTransactions) { tx in
                        TransactionRowView(transaction: tx)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    viewModel.deleteTransaction(id: tx.id)
                                } label: {
                                    Label("Elimina", systemImage: "trash")
                                }
                            }
                            .onAppear {
                                if tx.id == paginatedTransactions.last?.id && visibleLimit < filteredTransactions.count {
                                    visibleLimit += 20
                                }
                            }
                    }
                    
                    if visibleLimit < filteredTransactions.count {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .onAppear {
                            visibleLimit += 20
                        }
                    }
                }
                .listStyle(.plain)
            }
            .searchable(text: $searchText, prompt: "Cerca per nome...")
            .onChange(of: searchText) { _ in visibleLimit = 20 }
            .navigationTitle("Transazioni (\(filteredTransactions.count))")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showFilterSheet = true }) {
                        Image(systemName: "line.3.horizontal.decrease.circle" + ((useDateRange || !minPrice.isEmpty || !maxPrice.isEmpty) ? ".fill" : ""))
                    }
                }
            }
            .sheet(isPresented: $showFilterSheet) {
                NavigationView {
                    Form {
                        Section(header: Text("Filtra per Prezzo (€)")) {
                            TextField("Prezzo Minimo", text: $minPrice)
                                .keyboardType(.decimalPad)
                            TextField("Prezzo Massimo", text: $maxPrice)
                                .keyboardType(.decimalPad)
                        }
                        
                        Section(header: Text("Filtra per Data")) {
                            Toggle("Usa intervallo date", isOn: $useDateRange)
                            if useDateRange {
                                DatePicker("Da", selection: $startDate, displayedComponents: .date)
                                DatePicker("A", selection: $endDate, displayedComponents: .date)
                            }
                        }
                        
                        Section {
                            Button("Azzera Filtri") {
                                minPrice = ""
                                maxPrice = ""
                                useDateRange = false
                                showFilterSheet = false
                            }
                            .foregroundColor(.red)
                        }
                    }
                    .navigationTitle("Filtri Avanzati")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Fine") {
                                showFilterSheet = false
                                visibleLimit = 20
                            }
                        }
                    }
                }
            }
        }
    }
}

struct FilterPill: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .fontWeight(.medium)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isSelected ? Color.blue : Color(.secondarySystemBackground))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}
