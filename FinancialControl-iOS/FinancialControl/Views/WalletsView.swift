import SwiftUI
import Charts

// MARK: - Wallet list

struct WalletsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var showNewWallet = false
    @State private var path: [String] = DebugLaunch.initialWalletPath

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 14) {
                    if viewModel.data.wallets.isEmpty {
                        VStack(spacing: 4) {
                            EmptyStateView(icon: "wallet.pass.fill", title: "Nessun wallet ancora",
                                           text: "Crea un wallet per stanziare un importo (es. un viaggio o un progetto) e assegnargli le spese.")
                            Button { showNewWallet = true } label: {
                                Label("Crea il primo wallet", systemImage: "plus")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                        .card()
                    } else {
                        ForEach(viewModel.sortedWallets) { w in
                            if let st = viewModel.walletStats(id: w.id) {
                                NavigationLink(value: w.id) {
                                    WalletCard(stats: st)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Wallet")
            .navigationDestination(for: String.self) { id in
                WalletDetailView(walletId: id)
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showNewWallet = true } label: {
                        Image(systemName: "plus.circle.fill").font(.title2)
                    }
                    .accessibilityLabel("Nuovo wallet")
                }
            }
            .sheet(isPresented: $showNewWallet) {
                WalletFormSheet()
            }
        }
    }
}

extension WalletStats {
    var barColor: Color {
        if status == .negative { return Theme.danger }
        return (pctUsed ?? 100) >= 80 ? Theme.warning : Theme.success
    }
    var remainingColor: Color {
        switch status {
        case .positive: return Theme.success
        case .zero: return Theme.text2
        case .negative: return Theme.danger
        }
    }
    var pctLabel: String { pctUsed.map { "\(Int($0.rounded()))%" } ?? "—" }
    /// 0...1 for progress bars; overspent (or nothing available) shows full
    var barValue: Double { (pctUsed ?? 100) / 100 }
}

extension Wallet {
    var periodLabel: String? {
        switch (startDate, endDate) {
        case let (s?, e?): return "\(Fmt.date(s)) – \(Fmt.date(e))"
        case let (s?, nil): return "dal \(Fmt.date(s))"
        case let (nil, e?): return "fino al \(Fmt.date(e))"
        default: return nil
        }
    }
}

struct WalletCard: View {
    let stats: WalletStats

    var body: some View {
        let c = Color.wallet(stats.wallet.color)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "wallet.pass.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(c)
                    .frame(width: 38, height: 38)
                    .background(c.opacity(0.15), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(stats.wallet.name).font(.headline).foregroundColor(Theme.text).lineLimit(1)
                    if let p = stats.wallet.periodLabel {
                        Text(p).font(.caption).foregroundColor(Theme.text3)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundColor(Theme.text3)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Saldo disponibile").font(.caption).foregroundColor(Theme.text2)
                Text(Fmt.eur(stats.remaining))
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundColor(stats.remainingColor)
                Text("base \(Fmt.eur(stats.allocated))" + (stats.credits > 0 ? " + \(Fmt.eur(stats.credits)) entrate" : ""))
                    .font(.caption).foregroundColor(Theme.text3)
            }
            ProgressBar(value: stats.barValue, color: stats.barColor)
            Text("\(stats.txs.count) transazioni · \(stats.pctLabel) usato")
                .font(.caption.weight(.medium)).foregroundColor(Theme.text2)
        }
        .card()
        .overlay(alignment: .leading) {
            Capsule().fill(c).frame(width: 4).padding(.vertical, 22)
        }
    }
}

// MARK: - Wallet detail

struct WalletDetailView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @Environment(\.dismiss) private var dismiss
    let walletId: String

    @State private var showEdit = false
    @State private var showPicker = false
    @State private var showNewTx = false
    @State private var editingTx: Transaction? = nil
    @State private var confirmDelete = false

    var body: some View {
        Group {
            if let st = viewModel.walletStats(id: walletId) {
                content(st)
            } else {
                EmptyStateView(icon: "wallet.pass", title: "Wallet non trovato").screenBackground()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ st: WalletStats) -> some View {
        List {
            Group {
                hero(st)
                kpis(st)
                categoryCard(st)
                if !st.txs.isEmpty { timelineCard(st) }
            }
            .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            if st.txs.isEmpty {
                VStack(spacing: 6) {
                    EmptyStateView(icon: "list.bullet.rectangle", title: "Nessun movimento in questo wallet",
                                   text: "Aggiungi spese esistenti o registra un nuovo movimento nel wallet.")
                    Button { showPicker = true } label: { Label("Aggiungi spese esistenti", systemImage: "checklist") }
                        .buttonStyle(PrimaryButtonStyle())
                }
                .card()
                .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else {
                ForEach(groupByDay(st.txs)) { group in
                    Section {
                        ForEach(group.txs) { tx in
                            Button { editingTx = tx } label: {
                                TransactionRowView(transaction: tx, showsWallet: false)
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Theme.surface)
                            .swipeActions(edge: .trailing) {
                                Button { viewModel.assignWallet(txIds: [tx.id], walletId: nil) } label: {
                                    Label("Rimuovi", systemImage: "minus.circle")
                                }
                                .tint(Theme.warning)
                            }
                        }
                    } header: {
                        DayHeader(group: group)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(st.wallet.name)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { showNewTx = true } label: { Label("Nuovo movimento", systemImage: "plus") }
                    Button { showPicker = true } label: { Label("Aggiungi spese esistenti", systemImage: "checklist") }
                    Button { showEdit = true } label: { Label("Modifica wallet", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Elimina wallet", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle.fill").font(.title2)
                }
            }
        }
        .sheet(isPresented: $showEdit) { WalletFormSheet(wallet: st.wallet) }
        .sheet(isPresented: $showPicker) { WalletTxPickerSheet(walletId: walletId) }
        .sheet(isPresented: $showNewTx) { AddExpenseSheet(presetWalletId: walletId) }
        .sheet(item: $editingTx) { tx in AddExpenseSheet(editing: tx) }
        .confirmationDialog(
            st.txs.isEmpty
                ? "Eliminare il wallet \"\(st.wallet.name)\"?"
                : "Eliminare il wallet \"\(st.wallet.name)\"? Le \(st.txs.count) transazioni assegnate resteranno, ma senza wallet.",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Elimina", role: .destructive) {
                viewModel.deleteWallet(id: walletId)
                dismiss()
            }
        }
    }

    private func hero(_ st: WalletStats) -> some View {
        let c = Color.wallet(st.wallet.color)
        return VStack(alignment: .leading, spacing: 8) {
            Text([st.wallet.periodLabel, st.wallet.notes].compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "Saldo disponibile")
                .font(.subheadline.weight(.medium))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(2)
            Text(Fmt.eur(st.remaining))
                .font(.system(size: 42, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            statusPill(st)
            VStack(alignment: .leading, spacing: 6) {
                ProgressBar(value: st.barValue, color: .white, track: .white.opacity(0.25))
                Text("\(st.pctLabel) utilizzato — uscite \(Fmt.eur(st.spent)) su \(Fmt.eur(st.available)) disponibili")
                    .font(.caption.weight(.medium))
                    .foregroundColor(.white.opacity(0.9))
            }
            .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [c.opacity(0.85), c], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .shadow(color: c.opacity(0.3), radius: 14, x: 0, y: 8)
    }

    private func statusPill(_ st: WalletStats) -> some View {
        let (icon, text): (String, String) = {
            switch st.status {
            case .positive: return ("checkmark.circle.fill", "Disponibile: restano \(Fmt.eur(st.remaining))")
            case .zero: return ("circle.dashed", "Esaurito: il wallet è stato speso interamente")
            case .negative: return ("exclamationmark.triangle.fill", "Sforato: superato di \(Fmt.eur(abs(st.remaining)))")
            }
        }()
        return Label(text, systemImage: icon)
            .font(.footnote.weight(.semibold))
            .foregroundColor(st.status == .negative ? Theme.danger : Theme.text)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color.white.opacity(0.92), in: Capsule())
            .environment(\.colorScheme, .light)
    }

    private func kpis(_ st: WalletStats) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            kpi("Stanziato", Fmt.eur(st.allocated), Theme.text, "banknote")
            kpi("Entrate", "+\(Fmt.eur(st.credits))", Theme.success, "arrow.down.left")
            kpi("Uscite", "−\(Fmt.eur(st.spent))", Theme.accent, "arrow.up.right")
            kpi("Rimanente", Fmt.eur(st.remaining), st.remainingColor, "equal",
                footnote: "\(Fmt.eur(st.allocated)) + \(Fmt.eur(st.credits)) − \(Fmt.eur(st.spent))")
        }
    }

    private func kpi(_ label: String, _ value: String, _ color: Color, _ icon: String, footnote: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(label, systemImage: icon).font(.caption.weight(.semibold)).foregroundColor(Theme.text2)
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundColor(color)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let f = footnote {
                Text(f).font(.caption2).foregroundColor(Theme.text3).lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
        .card(padding: 14)
    }

    private func categoryCard(_ st: WalletStats) -> some View {
        let items = st.byCategory.map { (cat: $0.key, value: $0.value) }.sorted { $0.value > $1.value }
        return VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Spese per categoria")
            if items.isEmpty {
                EmptyStateView(icon: "chart.pie", title: "Nessuna spesa assegnata")
            } else {
                if #available(iOS 17.0, *) {
                    Chart(items, id: \.cat) { item in
                        SectorMark(angle: .value("Importo", item.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .cornerRadius(4)
                            .foregroundStyle(CategoryStyle.color(item.cat))
                    }
                    .chartBackground { _ in
                        VStack(spacing: 0) {
                            Text("Uscite").font(.caption).foregroundColor(Theme.text2)
                            Text(Fmt.eurCompact(st.spent)).font(.system(.title3, design: .rounded).weight(.heavy))
                        }
                    }
                    .frame(height: 190)
                }
                ForEach(items, id: \.cat) { item in
                    HStack(spacing: 10) {
                        CategoryAvatar(category: item.cat, size: 32)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(item.cat).font(.subheadline.weight(.medium)).lineLimit(1)
                                Spacer()
                                Text(Fmt.eur(item.value)).font(.subheadline.weight(.semibold))
                            }
                            ProgressBar(value: st.spent > 0 ? item.value / st.spent : 0, color: CategoryStyle.color(item.cat), height: 5)
                        }
                    }
                }
            }
        }
        .card()
    }

    private func timelineCard(_ st: WalletStats) -> some View {
        let tl = WalletTimeline(txs: st.txs, base: st.allocated)
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Andamento")
            Chart {
                ForEach(tl.flows) { f in
                    BarMark(x: .value("Data", f.date, unit: tl.unit), y: .value("Importo", f.value))
                        .foregroundStyle(f.value >= 0 ? Theme.success.opacity(0.75) : Theme.accent.opacity(0.75))
                        .cornerRadius(4)
                }
                ForEach(tl.balance) { p in
                    LineMark(x: .value("Data", p.date, unit: tl.unit), y: .value("Saldo", p.value))
                        .foregroundStyle(Theme.text)
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2.5))
                    if tl.balance.count <= 40 {
                        PointMark(x: .value("Data", p.date, unit: tl.unit), y: .value("Saldo", p.value))
                            .foregroundStyle(Theme.text)
                            .symbolSize(18)
                    }
                }
                RuleMark(y: .value("Zero", 0)).foregroundStyle(Theme.text3.opacity(0.4))
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 210)
            HStack(spacing: 14) {
                legend(Theme.text, "Saldo")
                legend(Theme.success, "Entrate (+)")
                legend(Theme.accent, "Uscite (−)")
            }
            .font(.caption)
            .foregroundColor(Theme.text2)
        }
        .card()
    }

    private func legend(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 5) { Circle().fill(c).frame(width: 8, height: 8); Text(t) }
    }
}

/// Same series as the web walletTimeline chart: per-day buckets when the span is ≤ 62 days, else per month,
/// income up / expenses down, and the running balance starting from the base amount one period before.
struct WalletTimeline {
    struct Point: Identifiable {
        let id = UUID()
        let date: Date
        let value: Double
    }
    let unit: Calendar.Component
    let flows: [Point]
    let balance: [Point]

    init(txs: [Transaction], base: Double) {
        let cal = Calendar.current
        let sorted = txs.sorted { $0.date < $1.date }
        guard let first = sorted.first?.parsedDate, let last = sorted.last?.parsedDate else {
            unit = .day; flows = []; balance = []; return
        }
        let byDay = (cal.dateComponents([.day], from: first, to: last).day ?? 0) <= 62
        unit = byDay ? .day : .month
        func bucket(_ d: Date) -> Date {
            byDay ? cal.startOfDay(for: d) : cal.date(from: cal.dateComponents([.year, .month], from: d)) ?? d
        }
        var inc: [Date: Double] = [:], exp: [Date: Double] = [:]
        for t in sorted {
            let k = bucket(t.parsedDate)
            if t.amountEUR > 0 { inc[k, default: 0] += t.amountEUR } else { exp[k, default: 0] += abs(t.amountEUR) }
        }
        var keys: [Date] = []
        var cur = bucket(first)
        let end = bucket(last)
        while cur <= end {
            keys.append(cur)
            cur = cal.date(byAdding: unit, value: 1, to: cur) ?? end.addingTimeInterval(1)
        }
        var f: [Point] = []
        var b: [Point] = [Point(date: cal.date(byAdding: unit, value: -1, to: keys[0]) ?? keys[0], value: base)]
        var run = base
        for k in keys {
            if let v = inc[k] { f.append(Point(date: k, value: v)) }
            if let v = exp[k] { f.append(Point(date: k, value: -v)) }
            run += (inc[k] ?? 0) - (exp[k] ?? 0)
            b.append(Point(date: k, value: run))
        }
        flows = f
        balance = b
    }
}

// MARK: - Create / edit wallet

struct WalletFormSheet: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @Environment(\.dismiss) private var dismiss
    var wallet: Wallet? = nil

    @State private var name = ""
    @State private var amountText = ""
    @State private var color = Wallet.palette[0]
    @State private var hasStart = false
    @State private var hasEnd = false
    @State private var start = Date()
    @State private var end = Date()
    @State private var notes = ""
    @State private var error: String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nome (es. Viaggio Giappone)", text: $name)
                    HStack {
                        Text("Importo stanziato")
                        Spacer()
                        TextField("0,00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .font(.body.weight(.semibold))
                        Text("€").foregroundColor(Theme.text2)
                    }
                }
                Section("Colore") {
                    HStack(spacing: 0) {
                        ForEach(Wallet.palette, id: \.self) { hex in
                            Button { color = hex } label: {
                                Circle().fill(Color(hex: hex))
                                    .frame(width: 30, height: 30)
                                    .overlay(Circle().stroke(Theme.text, lineWidth: color == hex ? 2.5 : 0).padding(-4))
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Colore \(hex)")
                        }
                    }
                    .padding(.vertical, 6)
                }
                Section {
                    Toggle("Data di inizio", isOn: $hasStart.animation())
                    if hasStart { DatePicker("Inizio", selection: $start, displayedComponents: .date) }
                    Toggle("Data di fine", isOn: $hasEnd.animation())
                    if hasEnd { DatePicker("Fine", selection: $end, displayedComponents: .date) }
                } header: {
                    Text("Periodo (opzionale)")
                }
                Section("Note") {
                    TextField("Note", text: $notes, axis: .vertical).lineLimit(1...4)
                }
                if let error = error {
                    Section { Text(error).foregroundColor(Theme.danger).font(.footnote) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(wallet == nil ? "Nuovo wallet" : "Modifica wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annulla") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Salva") { save() }.fontWeight(.bold) }
            }
            .onAppear(perform: load)
        }
        .tint(Theme.accent)
    }

    private func load() {
        if let w = wallet {
            name = w.name
            amountText = String(format: "%.2f", w.amount)
            color = w.color
            if let s = w.startDate.flatMap({ Transaction.dayFormatter.date(from: $0) }) { hasStart = true; start = s }
            if let e = w.endDate.flatMap({ Transaction.dayFormatter.date(from: $0) }) { hasEnd = true; end = e }
            notes = w.notes ?? ""
        } else {
            color = Wallet.palette[viewModel.data.wallets.count % Wallet.palette.count]
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let amount = Double(amountText.replacingOccurrences(of: ",", with: ".")), amount >= 0 else {
            error = "Inserisci un nome e un importo valido"
            return
        }
        let s = hasStart ? Transaction.dayFormatter.string(from: start) : nil
        let e = hasEnd ? Transaction.dayFormatter.string(from: end) : nil
        if let s = s, let e = e, e < s {
            error = "La data di fine è precedente a quella di inizio"
            return
        }
        viewModel.saveWallet(id: wallet?.id, name: trimmed, amount: amount, color: color, startDate: s, endDate: e, notes: notes)
        dismiss()
    }
}

// MARK: - Pick existing transactions for a wallet

struct WalletTxPickerSheet: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @Environment(\.dismiss) private var dismiss
    let walletId: String

    @State private var selected = Set<String>()
    @State private var search = ""
    @State private var expensesOnly = true
    @State private var limit = 60

    private var candidates: [Transaction] {
        viewModel.data.transactions
            .filter { $0.walletId == nil && $0.category != "__exchange__" }
            .filter { !expensesOnly || $0.amountEUR < 0 }
            .filter { search.isEmpty || $0.matches(search) }
            .sorted { $0.date > $1.date }
    }

    var body: some View {
        NavigationStack {
            let all = candidates
            List {
                Picker("Mostra", selection: $expensesOnly) {
                    Text("Solo spese").tag(true)
                    Text("Tutti i movimenti").tag(false)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if all.isEmpty {
                    EmptyStateView(icon: "tray", title: "Nessun movimento senza wallet")
                        .listRowBackground(Color.clear)
                }
                ForEach(groupByDay(Array(all.prefix(limit)))) { group in
                    Section {
                        ForEach(group.txs) { tx in
                            Button { toggle(tx.id) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: selected.contains(tx.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundColor(selected.contains(tx.id) ? Theme.accent : Theme.text3)
                                    TransactionRowView(transaction: tx, showsWallet: false)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    } header: { DayHeader(group: group) }
                }
                if all.count > limit {
                    Button("Mostra altri") { limit += 60 }
                        .frame(maxWidth: .infinity)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .searchable(text: $search, prompt: "Cerca")
            .navigationTitle("Aggiungi a \(viewModel.wallet(id: walletId)?.name ?? "wallet")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annulla") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    viewModel.assignWallet(txIds: selected, walletId: walletId)
                    dismiss()
                } label: {
                    Text(selected.isEmpty ? "Seleziona i movimenti" : "Assegna \(selected.count) movimenti")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(selected.isEmpty)
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .tint(Theme.accent)
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }
}

extension Transaction {
    /// Search on description, notes and bank details, like the web app
    func matches(_ query: String) -> Bool {
        description.localizedCaseInsensitiveContains(query)
            || (notes?.localizedCaseInsensitiveContains(query) ?? false)
            || (details?.localizedCaseInsensitiveContains(query) ?? false)
    }
}
