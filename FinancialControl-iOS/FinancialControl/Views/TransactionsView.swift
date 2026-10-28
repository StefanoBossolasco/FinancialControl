import SwiftUI

struct TransactionsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var searchText = ""
    @State private var selectedCategory = "Tutte"
    /// "" = all, "__none__" = without wallet, otherwise a wallet id (same values as the web filter)
    @State private var walletFilter = ""

    // Filtri Avanzati
    @State private var showFilterSheet = false
    @State private var minPrice: String = ""
    @State private var maxPrice: String = ""
    @State private var startDate: Date = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    @State private var endDate: Date = Date()
    @State private var useDateRange = false

    // Selezione multipla
    @State private var isSelecting = false
    @State private var selection = Set<String>()

    @State private var editingTx: Transaction? = nil
    @State private var showAddSheet = false

    // Paginazione UI
    @State private var visibleLimit: Int = 40

    var filteredTransactions: [Transaction] {
        let allTxs = viewModel.data.transactions.sorted(by: { $0.date > $1.date })
        return allTxs.filter { tx in
            if !searchText.isEmpty && !tx.matches(searchText) { return false }
            if selectedCategory != "Tutte" && tx.category != selectedCategory { return false }
            if walletFilter == "__none__" && tx.walletId != nil { return false }
            if !walletFilter.isEmpty && walletFilter != "__none__" && tx.walletId != walletFilter { return false }

            let price = abs(tx.amountEUR)
            if let min = Double(minPrice.replacingOccurrences(of: ",", with: ".")), price < min { return false }
            if let max = Double(maxPrice.replacingOccurrences(of: ",", with: ".")), price > max { return false }

            if useDateRange {
                let txDate = tx.parsedDate
                if txDate < Calendar.current.startOfDay(for: startDate) || txDate > Calendar.current.date(byAdding: .day, value: 1, to: endDate)! {
                    return false
                }
            }
            return true
        }
    }

    private var hasAdvancedFilters: Bool { useDateRange || !minPrice.isEmpty || !maxPrice.isEmpty }

    var body: some View {
        NavigationStack {
            let filtered = filteredTransactions
            let page = Array(filtered.prefix(visibleLimit))
            List {
                Section {
                    filterBar
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                if filtered.isEmpty {
                    EmptyStateView(icon: "magnifyingglass", title: "Nessun movimento", text: "Prova a cambiare i filtri.")
                        .listRowBackground(Color.clear)
                }

                ForEach(groupByDay(page)) { group in
                    Section {
                        ForEach(group.txs) { tx in
                            row(tx)
                                .listRowBackground(selection.contains(tx.id) ? Theme.accentSoft : Theme.surface)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        viewModel.deleteTransaction(id: tx.id)
                                    } label: {
                                        Label("Elimina", systemImage: "trash")
                                    }
                                }
                                .contextMenu { contextMenu(tx) }
                        }
                    } header: {
                        DayHeader(group: group)
                    }
                }

                if visibleLimit < filtered.count {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .onAppear { visibleLimit += 40 }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .screenBackground()
            .searchable(text: $searchText, prompt: "Cerca descrizione, note, dettagli")
            .onChange(of: searchText) { _ in visibleLimit = 40 }
            .navigationTitle("Movimenti")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(isSelecting ? "Fine" : "Seleziona") {
                        withAnimation {
                            isSelecting.toggle()
                            selection.removeAll()
                        }
                    }
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button(action: { showFilterSheet = true }) {
                        Image(systemName: "line.3.horizontal.decrease.circle" + (hasAdvancedFilters ? ".fill" : ""))
                    }
                    Button(action: { showAddSheet = true }) {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if isSelecting { bulkBar(filtered) }
            }
            .sheet(item: $editingTx) { tx in AddExpenseSheet(editing: tx) }
            .sheet(isPresented: $showAddSheet) { AddExpenseSheet() }
            .sheet(isPresented: $showFilterSheet) { filterSheet }
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func row(_ tx: Transaction) -> some View {
        Button {
            if isSelecting {
                if selection.contains(tx.id) { selection.remove(tx.id) } else { selection.insert(tx.id) }
            } else {
                editingTx = tx
            }
        } label: {
            HStack(spacing: 10) {
                if isSelecting {
                    Image(systemName: selection.contains(tx.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundColor(selection.contains(tx.id) ? Theme.accent : Theme.text3)
                }
                TransactionRowView(transaction: tx)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func contextMenu(_ tx: Transaction) -> some View {
        Button { editingTx = tx } label: { Label("Modifica", systemImage: "pencil") }
        Menu {
            ForEach(viewModel.data.categories, id: \.self) { cat in
                Button { viewModel.updateCategory(txId: tx.id, category: cat) } label: {
                    Label(cat, systemImage: tx.category == cat ? "checkmark" : CategoryStyle.icon(cat))
                }
            }
        } label: { Label("Categoria", systemImage: "tag") }
        Menu {
            ForEach(viewModel.sortedWallets) { w in
                Button { viewModel.assignWallet(txIds: [tx.id], walletId: w.id) } label: {
                    Label(w.name, systemImage: tx.walletId == w.id ? "checkmark" : "wallet.pass")
                }
            }
            if tx.walletId != nil {
                Button(role: .destructive) { viewModel.assignWallet(txIds: [tx.id], walletId: nil) } label: {
                    Label("Rimuovi dal wallet", systemImage: "minus.circle")
                }
            }
        } label: { Label("Wallet", systemImage: "wallet.pass") }
        Button(role: .destructive) { viewModel.deleteTransaction(id: tx.id) } label: {
            Label("Elimina", systemImage: "trash")
        }
    }

    // MARK: - Filters

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    Picker("Wallet", selection: $walletFilter) {
                        Text("Tutti i wallet").tag("")
                        Text("Senza wallet").tag("__none__")
                        ForEach(viewModel.sortedWallets) { w in Text(w.name).tag(w.id) }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "wallet.pass.fill")
                        Text(walletFilterLabel)
                        Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(walletFilter.isEmpty ? Theme.surface : Theme.text, in: Capsule())
                    .foregroundColor(walletFilter.isEmpty ? Theme.text : Theme.bg)
                }
                FilterPill(title: "Tutte", isSelected: selectedCategory == "Tutte") {
                    selectedCategory = "Tutte"
                    visibleLimit = 40
                }
                ForEach(viewModel.data.categories, id: \.self) { cat in
                    FilterPill(title: cat, isSelected: selectedCategory == cat) {
                        selectedCategory = cat
                        visibleLimit = 40
                    }
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 4)
        }
        .onChange(of: walletFilter) { _ in visibleLimit = 40 }
    }

    private var walletFilterLabel: String {
        if walletFilter.isEmpty { return "Wallet" }
        if walletFilter == "__none__" { return "Senza wallet" }
        return viewModel.wallet(id: walletFilter)?.name ?? "Wallet"
    }

    private var filterSheet: some View {
        NavigationStack {
            Form {
                Section(header: Text("Filtra per importo (€)")) {
                    TextField("Importo minimo", text: $minPrice)
                        .keyboardType(.decimalPad)
                    TextField("Importo massimo", text: $maxPrice)
                        .keyboardType(.decimalPad)
                }

                Section(header: Text("Filtra per data")) {
                    Toggle("Usa intervallo date", isOn: $useDateRange)
                    if useDateRange {
                        DatePicker("Da", selection: $startDate, displayedComponents: .date)
                        DatePicker("A", selection: $endDate, displayedComponents: .date)
                    }
                }

                Section {
                    Button("Azzera filtri") {
                        minPrice = ""
                        maxPrice = ""
                        useDateRange = false
                        walletFilter = ""
                        selectedCategory = "Tutte"
                        showFilterSheet = false
                    }
                    .foregroundColor(Theme.danger)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Filtri")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Fine") {
                        showFilterSheet = false
                        visibleLimit = 40
                    }
                    .fontWeight(.bold)
                }
            }
        }
        .tint(Theme.accent)
        .presentationDetents([.medium, .large])
    }

    // MARK: - Bulk bar

    private func bulkBar(_ filtered: [Transaction]) -> some View {
        HStack(spacing: 10) {
            Button {
                if selection.count == filtered.count { selection.removeAll() } else { selection = Set(filtered.map(\.id)) }
            } label: {
                Text(selection.count == filtered.count && !filtered.isEmpty ? "Nessuno" : "Tutti (\(filtered.count))")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(SoftButtonStyle())

            Spacer()

            Text("\(selection.count) sel.")
                .font(.subheadline.weight(.semibold))
                .foregroundColor(Theme.text2)

            Menu {
                ForEach(viewModel.sortedWallets) { w in
                    Button(w.name) { assign(w.id) }
                }
                if !viewModel.data.wallets.isEmpty { Divider() }
                Button(role: .destructive) { assign(nil) } label: {
                    Label("Rimuovi dal wallet", systemImage: "minus.circle")
                }
            } label: {
                Label("Assegna", systemImage: "wallet.pass.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.accent, in: Capsule())
            }
            .disabled(selection.isEmpty)
            .opacity(selection.isEmpty ? 0.5 : 1)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 6)
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private func assign(_ walletId: String?) {
        viewModel.assignWallet(txIds: selection, walletId: walletId)
        selection.removeAll()
        isSelecting = false
    }
}

struct FilterPill: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(isSelected ? Theme.accent : Theme.surface, in: Capsule())
                .foregroundColor(isSelected ? .white : Theme.text)
        }
        .buttonStyle(.plain)
    }
}
