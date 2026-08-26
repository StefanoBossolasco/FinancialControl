import SwiftUI

struct BudgetView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // Header Total Summary Card
                    let budgets = viewModel.data.budgets["default"] ?? [:]
                    let totalAllocated = budgets.values.reduce(0, +)
                    let totalSpent = viewModel.monthlyExpenses(year: viewModel.selectedYear, month: viewModel.selectedMonth)
                    let remaining = totalAllocated - totalSpent

                    VStack(alignment: .leading, spacing: 12) {
                        Text("BUDGET PREVISTO BASELINE")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.secondary)

                        Text("€ \(totalAllocated, specifier: "%.0f")")
                            .font(.system(size: 32, weight: .bold, design: .rounded))

                        HStack {
                            VStack(alignment: .leading) {
                                Text("Spesa Mese").font(.caption).foregroundColor(.secondary)
                                Text("€ \(totalSpent, specifier: "%.0f")").font(.headline).foregroundColor(.red)
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text("Rimanente").font(.caption).foregroundColor(.secondary)
                                Text("€ \(remaining, specifier: "%.0f")").font(.headline).foregroundColor(remaining >= 0 ? .green : .red)
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)

                    // Categories List
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Dettaglio per Categoria")
                            .font(.headline)

                        ForEach(viewModel.data.categories, id: \.self) { category in
                            let target = budgets[category] ?? 0
                            let txs = viewModel.monthlyTxs(year: viewModel.selectedYear, month: viewModel.selectedMonth)
                            let spent = txs.filter { $0.category == category && $0.amountEUR < 0 }.reduce(0) { $0 + abs($1.amountEUR) }
                            let pct = target > 0 ? min(spent / target, 1.0) : 0

                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(category)
                                        .font(.body)
                                        .fontWeight(.semibold)
                                    Spacer()
                                    Text("€ \(spent, specifier: "%.0f") / € \(target, specifier: "%.0f")")
                                        .font(.subheadline)
                                        .foregroundColor(spent > target && target > 0 ? .red : .secondary)
                                }

                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color(.tertiarySystemBackground))
                                            .frame(height: 8)
                                        Capsule()
                                            .fill(spent > target && target > 0 ? Color.red : Color.blue)
                                            .frame(width: geo.size.width * CGFloat(pct), height: 8)
                                    }
                                }
                                .frame(height: 8)
                            }
                            .padding(14)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(16)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Gestione Budget")
            .refreshable {
                await viewModel.syncFromGitHub()
            }
        }
    }
}
