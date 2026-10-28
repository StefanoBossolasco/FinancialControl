import SwiftUI
import Charts

struct DashboardView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var isAddSheetPresented = false
    @State private var editingTx: Transaction? = nil
    @AppStorage("isBalanceHidden") private var isBalanceHidden = false

    private var ym: String { String(format: "%04d-%02d", viewModel.selectedYear, viewModel.selectedMonth) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    monthSwitcher
                    heroCard
                    quickActions
                    balanceCard
                    if !viewModel.data.wallets.isEmpty { walletsStrip }
                    categoryCard
                    MonthlyBudgetOverviewView(isBalanceHidden: isBalanceHidden)
                    recentCard
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Ciao 👋")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { isBalanceHidden.toggle() }) {
                        Image(systemName: isBalanceHidden ? "eye.slash.fill" : "eye.fill")
                    }
                    .accessibilityLabel(isBalanceHidden ? "Mostra importi" : "Nascondi importi")
                }
            }
            .refreshable { await viewModel.syncData() }
            .sheet(isPresented: $isAddSheetPresented) { AddExpenseSheet() }
            .sheet(item: $editingTx) { tx in AddExpenseSheet(editing: tx) }
        }
    }

    private func money(_ v: Double, compact: Bool = false) -> String {
        isBalanceHidden ? "•••" : (compact ? Fmt.eurCompact(v) : Fmt.eur(v))
    }

    // MARK: - Month

    private var monthSwitcher: some View {
        HStack {
            Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text("\(Fmt.monthName(viewModel.selectedMonth)) \(String(viewModel.selectedYear))")
                .font(.system(.headline, design: .rounded))
            Spacer()
            Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
        }
        .font(.headline)
        .foregroundColor(Theme.text)
        .padding(.horizontal, 6)
    }

    private func shiftMonth(_ delta: Int) {
        var m = viewModel.selectedMonth + delta
        var y = viewModel.selectedYear
        if m < 1 { m = 12; y -= 1 }
        if m > 12 { m = 1; y += 1 }
        viewModel.selectedMonth = m
        viewModel.selectedYear = y
    }

    // MARK: - Hero (same figures as the web dashboard)

    private var heroCard: some View {
        let txs = viewModel.monthlyTxs(year: viewModel.selectedYear, month: viewModel.selectedMonth)
        let totalExp = txs.filter { $0.amountEUR < 0 }.reduce(0) { $0 + abs($1.amountEUR) }
        let totalInc = txs.filter { $0.amountEUR > 0 }.reduce(0) { $0 + $1.amountEUR }
        let budgets = viewModel.allBudgets(yearMonth: ym)
        let totalBud = budgets.values.reduce(0, +)
        let remaining = totalBud - totalExp
        let catTotals = viewModel.categoryTotals(yearMonth: ym)
        let over = catTotals.filter { cat, spent in (budgets[cat] ?? 0) > 0 && spent > (budgets[cat] ?? 0) }.count
        let pct = totalBud > 0 ? totalExp / totalBud * 100 : 0

        return VStack(alignment: .leading, spacing: 14) {
            Text("Spese del mese")
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.white.opacity(0.85))
            Text(money(totalExp))
                .font(.system(size: 44, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            VStack(alignment: .leading, spacing: 6) {
                ProgressBar(value: pct / 100, color: .white, track: .white.opacity(0.25))
                Text("\(Int(min(pct, 999).rounded()))% del budget mensile")
                    .font(.caption.weight(.medium))
                    .foregroundColor(.white.opacity(0.9))
            }
            HStack(spacing: 8) {
                heroStat("Entrate", "arrow.down.left", money(totalInc, compact: true))
                heroStat("Rimasto", "banknote", money(remaining, compact: true))
                heroStat("Sforate", "flame.fill", "\(over)")
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.hero, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Theme.accent.opacity(0.3), radius: 16, x: 0, y: 10)
    }

    private func heroStat(_ label: String, _ icon: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(label, systemImage: icon)
                .font(.caption2.weight(.semibold))
                .foregroundColor(.white.opacity(0.85))
            Text(value)
                .font(.system(.callout, design: .rounded).weight(.bold))
                .foregroundColor(.white)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Quick actions

    private var quickActions: some View {
        HStack(spacing: 0) {
            quickAction("plus", "Nuova spesa", accent: true) { isAddSheetPresented = true }
            NavigationLink { ImportView() } label: { quickActionLabel("square.and.arrow.down", "Importa") }
            NavigationLink { BudgetView() } label: { quickActionLabel("banknote", "Budget") }
            NavigationLink { WalletsListLink() } label: { quickActionLabel("wallet.pass", "Wallet") }
        }
        .buttonStyle(.plain)
        .card(padding: 14)
    }

    private func quickAction(_ icon: String, _ title: String, accent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { quickActionLabel(icon, title, accent: accent) }
    }

    private func quickActionLabel(_ icon: String, _ title: String, accent: Bool = false) -> some View {
        VStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(accent ? .white : Theme.text)
                .frame(width: 50, height: 50)
                .background(accent ? Theme.accent : Theme.surface2, in: Circle())
            Text(title).font(.caption.weight(.semibold)).foregroundColor(Theme.text)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Balance

    private var balanceCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Saldo totale").font(.caption.weight(.semibold)).foregroundColor(Theme.text2)
                Text(money(viewModel.totalCurrentBalance))
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .foregroundColor(Theme.text)
            }
            Spacer()
            Image(systemName: "building.columns.fill")
                .foregroundColor(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.accentSoft, in: Circle())
        }
        .card()
    }

    // MARK: - Wallets

    private var walletsStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "Wallet").padding(.horizontal, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(viewModel.sortedWallets) { w in
                        if let st = viewModel.walletStats(id: w.id) {
                            NavigationLink { WalletDetailView(walletId: w.id) } label: {
                                miniWallet(st)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 2).padding(.bottom, 8)
            }
        }
    }

    private func miniWallet(_ st: WalletStats) -> some View {
        let c = Color.wallet(st.wallet.color)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(c).frame(width: 8, height: 8)
                Text(st.wallet.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            Text(money(st.remaining))
                .font(.system(.title3, design: .rounded).weight(.heavy))
                .foregroundColor(st.remainingColor)
                .lineLimit(1).minimumScaleFactor(0.7)
            ProgressBar(value: st.barValue, color: st.barColor, height: 6)
            Text("\(st.pctLabel) usato").font(.caption2).foregroundColor(Theme.text3)
        }
        .frame(width: 170, alignment: .leading)
        .card(padding: 14)
    }

    // MARK: - Categories

    private var categoryCard: some View {
        let totals = viewModel.categoryTotals(yearMonth: ym).sorted { $0.value > $1.value }
        let sum = totals.reduce(0) { $0 + $1.value }
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Spese per categoria")
            if totals.isEmpty {
                EmptyStateView(icon: "chart.pie", title: "Nessuna spesa in questo mese")
            } else {
                if #available(iOS 17.0, *) {
                    Chart(totals, id: \.key) { item in
                        SectorMark(angle: .value("Importo", item.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .cornerRadius(4)
                            .foregroundStyle(CategoryStyle.color(item.key))
                    }
                    .chartBackground { _ in
                        VStack(spacing: 0) {
                            Text("Totale").font(.caption).foregroundColor(Theme.text2)
                            Text(money(sum, compact: true)).font(.system(.title3, design: .rounded).weight(.heavy))
                        }
                    }
                    .frame(height: 180)
                }
                ForEach(totals.prefix(6), id: \.key) { item in
                    HStack(spacing: 10) {
                        CategoryAvatar(category: item.key, size: 32)
                        Text(item.key).font(.subheadline.weight(.medium)).lineLimit(1)
                        Spacer()
                        Text(money(item.value)).font(.subheadline.weight(.semibold))
                        Text("\(Int((item.value / sum * 100).rounded()))%")
                            .font(.caption.weight(.semibold)).foregroundColor(Theme.text3)
                            .frame(width: 36, alignment: .trailing)
                    }
                }
            }
        }
        .card()
    }

    // MARK: - Recent

    private var recentCard: some View {
        let monthTxs = viewModel.data.transactions.filter { $0.month == ym }.sorted { $0.date > $1.date }
        return VStack(alignment: .leading, spacing: 6) {
            SectionTitle(title: "Movimenti del mese", trailing: "\(monthTxs.count)")
            if monthTxs.isEmpty {
                EmptyStateView(icon: "tray", title: "Nessuna transazione questo mese")
            } else {
                ForEach(groupByDay(Array(monthTxs.prefix(10)))) { group in
                    DayHeader(group: group, isBalanceHidden: isBalanceHidden).padding(.top, 8)
                    ForEach(group.txs) { tx in
                        Button { editingTx = tx } label: {
                            TransactionRowView(transaction: tx, isBalanceHidden: isBalanceHidden)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if monthTxs.count > 10 {
                    NavigationLink(destination: TransactionsView()) {
                        Text("Vedi tutte le \(monthTxs.count) transazioni")
                    }
                    .buttonStyle(SoftButtonStyle())
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                }
            }
        }
        .card()
    }
}

/// Wallet list pushed from the dashboard (WalletsView owns its own NavigationStack)
struct WalletsListLink: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if viewModel.data.wallets.isEmpty {
                    EmptyStateView(icon: "wallet.pass.fill", title: "Nessun wallet ancora",
                                   text: "Crea un wallet dalla scheda Wallet.").card()
                }
                ForEach(viewModel.sortedWallets) { w in
                    if let st = viewModel.walletStats(id: w.id) {
                        NavigationLink { WalletDetailView(walletId: w.id) } label: { WalletCard(stats: st) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Wallet")
    }
}

struct MonthlyBudgetOverviewView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    var isBalanceHidden: Bool

    var sortedCategoriesData: [(category: String, spent: Double, budget: Double)] {
        let ym = String(format: "%04d-%02d", viewModel.selectedYear, viewModel.selectedMonth)
        let budgets = viewModel.allBudgets(yearMonth: ym)
        let spent = viewModel.categoryTotals(yearMonth: ym)
        let cats = Set(spent.keys).union(budgets.filter { $0.value > 0 }.keys)
            .filter { $0 != "Entrate" && $0 != "Trasferimenti" }
        return cats.sorted { (spent[$0] ?? 0) > (spent[$1] ?? 0) }
            .map { (category: $0, spent: spent[$0] ?? 0, budget: budgets[$0] ?? 0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Budget vs effettivo")
            let data = sortedCategoriesData
            if data.isEmpty {
                EmptyStateView(icon: "banknote", title: "Nessun budget impostato",
                               text: "Definiscilo nella sezione Budget.")
            } else {
                ForEach(data, id: \.category) { item in
                    let isOver = item.budget > 0 && item.spent > item.budget
                    let ratio = item.budget > 0 ? item.spent / item.budget : (item.spent > 0 ? 1 : 0)
                    HStack(spacing: 10) {
                        CategoryAvatar(category: item.category, size: 32)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(item.category).font(.subheadline.weight(.medium)).lineLimit(1)
                                Spacer()
                                Text(isBalanceHidden ? "•••" : "\(Fmt.eurCompact(item.spent)) / \(item.budget > 0 ? Fmt.eurCompact(item.budget) : "∞")")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(isOver ? Theme.danger : Theme.text2)
                            }
                            ProgressBar(value: ratio,
                                        color: isOver ? Theme.danger : (item.budget > 0 ? (ratio > 0.8 ? Theme.warning : Theme.success) : Theme.text3),
                                        height: 6)
                        }
                    }
                }
            }
        }
        .card()
    }
}
