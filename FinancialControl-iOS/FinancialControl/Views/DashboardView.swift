import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var isAddSheetPresented = false
    @AppStorage("isBalanceHidden") private var isBalanceHidden = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Header Balance Card
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("SALDO PORTAFOGLIO")
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.secondary)
                            
                            Button(action: { isBalanceHidden.toggle() }) {
                                Image(systemName: isBalanceHidden ? "eye.slash.fill" : "eye.fill")
                                    .foregroundColor(.secondary)
                            }
                            
                            Spacer()
                            if viewModel.isSyncing {
                                ProgressView()
                                    .scaleEffect(0.8)
                            }
                        }

                        Text(isBalanceHidden ? "€ *******" : "€ \(viewModel.totalCurrentBalance, specifier: "%.2f")")
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                            .foregroundColor(.primary)

                        HStack(spacing: 20) {
                            let inc = viewModel.monthlyIncome(year: viewModel.selectedYear, month: viewModel.selectedMonth)
                            let exp = viewModel.monthlyExpenses(year: viewModel.selectedYear, month: viewModel.selectedMonth)

                            HStack(spacing: 6) {
                                Image(systemName: "arrow.down.left.circle.fill")
                                    .foregroundColor(.green)
                                VStack(alignment: .leading) {
                                    Text("Entrate Mese").font(.caption2).foregroundColor(.secondary)
                                    Text(isBalanceHidden ? "+€ ***" : "+€ \(inc, specifier: "%.0f")").font(.callout).fontWeight(.semibold).foregroundColor(.green)
                                }
                            }

                            HStack(spacing: 6) {
                                Image(systemName: "arrow.up.right.circle.fill")
                                    .foregroundColor(.red)
                                VStack(alignment: .leading) {
                                    Text("Uscite Mese").font(.caption2).foregroundColor(.secondary)
                                    Text(isBalanceHidden ? "-€ ***" : "-€ \(exp, specifier: "%.0f")").font(.callout).fontWeight(.semibold).foregroundColor(.red)
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)

                    // Quick Action Button
                    Button(action: { isAddSheetPresented = true }) {
                        HStack {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
                            Text("Nuova Spesa / Entrata")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(16)
                    }

                    // Budget Overview
                    MonthlyBudgetOverviewView(isBalanceHidden: isBalanceHidden)

                    // Riepilogo Mensile
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Transazioni del Mese")
                                .font(.headline)
                            Spacer()
                        }
                        .padding(.horizontal, 4)

                        let currentMonthStr = String(format: "%04d-%02d", viewModel.selectedYear, viewModel.selectedMonth)
                        let monthTxs = viewModel.data.transactions.filter { $0.month == currentMonthStr }.sorted(by: { $0.date > $1.date })
                        
                        if monthTxs.isEmpty {
                            Text("Nessuna transazione questo mese")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding()
                        } else {
                            ForEach(monthTxs.prefix(10)) { tx in
                                TransactionRowView(transaction: tx, isBalanceHidden: isBalanceHidden)
                            }
                            if monthTxs.count > 10 {
                                NavigationLink(destination: TransactionsView()) {
                                    Text("Vedi tutte le \(monthTxs.count) transazioni")
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .foregroundColor(.blue)
                                        .frame(maxWidth: .infinity)
                                        .padding()
                                        .background(Color(.secondarySystemBackground))
                                        .cornerRadius(12)
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .refreshable {
                await viewModel.syncData()
            }
            .sheet(isPresented: $isAddSheetPresented) {
                AddExpenseSheet()
            }
        }
    }
}

struct TransactionRowView: View {
    let transaction: Transaction
    var isBalanceHidden: Bool = false

    var body: some View {
        HStack {
            Image(systemName: transaction.isIncome ? "arrow.down.left.circle.fill" : "creditcard.fill")
                .font(.title2)
                .foregroundColor(transaction.isIncome ? .green : .blue)
                .frame(width: 40, height: 40)
                .background(Color(.tertiarySystemBackground))
                .cornerRadius(10)

            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.description)
                    .font(.body)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Text(transaction.category)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(isBalanceHidden ? "€ ***" : "\(transaction.isIncome ? "+" : "")€ \(abs(transaction.amountEUR), specifier: "%.2f")")
                    .font(.callout)
                    .fontWeight(.semibold)
                    .foregroundColor(transaction.isIncome ? .green : .primary)
                Text(transaction.date)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
    }
}
import SwiftUI

struct MonthlyBudgetOverviewView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    var isBalanceHidden: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Budget Mensile vs Spese")
                .font(.headline)
                .padding(.horizontal, 4)

            let currentMonthStr = String(format: "%04d-%02d", viewModel.selectedYear, viewModel.selectedMonth)
            let monthTxs = viewModel.data.transactions.filter { $0.month == currentMonthStr && $0.amountEUR < 0 && $0.category != "__exchange__" && $0.category != "Trasferimenti" }
            let budgets = viewModel.data.budgets[currentMonthStr] ?? viewModel.data.budgets["default"] ?? [:]
            
            // Calcola la somma per ogni categoria
            var expensesByCategory: [String: Double] = [:]
            for tx in monthTxs {
                expensesByCategory[tx.category, default: 0] += abs(tx.amountEUR)
            }
            
            // Trova tutte le categorie che hanno un budget o una spesa (escludendo Entrate)
            let allCategories = Set(expensesByCategory.keys).union(budgets.keys).filter { $0 != "Entrate" && $0 != "Trasferimenti" }
            
            let sortedCategories = allCategories.sorted {
                (expensesByCategory[$0] ?? 0) > (expensesByCategory[$1] ?? 0)
            }
            
            if sortedCategories.isEmpty {
                Text("Nessun dato budget o spese per questo mese.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 4)
            } else {
                ForEach(sortedCategories, id: \.self) { cat in
                    let spent = expensesByCategory[cat] ?? 0
                    let budget = budgets[cat] ?? 0
                    
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(cat)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            if isBalanceHidden {
                                Text("€ *** / ***")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            } else {
                                Text("€ \(spent, specifier: "%.0f") / \(budget > 0 ? "\(Int(budget))" : "∞")")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        
                        GeometryReader { geo in
                            let ratio = budget > 0 ? CGFloat(min(spent / budget, 1.0)) : (spent > 0 ? 1.0 : 0.0)
                            let isOver = budget > 0 && spent > budget
                            
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color(.tertiarySystemGroupedBackground))
                                    .frame(height: 8)
                                
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(isOver ? Color.red : (budget > 0 ? Color.blue : Color.orange))
                                    .frame(width: geo.size.width * ratio, height: 8)
                            }
                        }
                        .frame(height: 8)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(20)
    }
}
