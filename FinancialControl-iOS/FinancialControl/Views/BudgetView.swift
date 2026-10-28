import SwiftUI

struct BudgetView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    private var ym: String { String(format: "%04d-%02d", viewModel.selectedYear, viewModel.selectedMonth) }

    var body: some View {
        let budgets = viewModel.allBudgets(yearMonth: ym)
        let spentByCat = viewModel.categoryTotals(yearMonth: ym)
        let totalAllocated = budgets.values.reduce(0, +)
        let totalSpent = viewModel.monthlyExpenses(year: viewModel.selectedYear, month: viewModel.selectedMonth)
        let remaining = totalAllocated - totalSpent

        ScrollView {
            VStack(spacing: 16) {
                // Summary
                VStack(alignment: .leading, spacing: 12) {
                    Text("Budget di \(Fmt.monthName(viewModel.selectedMonth).lowercased()) \(String(viewModel.selectedYear))")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.white.opacity(0.85))
                    Text(Fmt.eurCompact(totalAllocated))
                        .font(.system(size: 40, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                    ProgressBar(value: totalAllocated > 0 ? totalSpent / totalAllocated : 0, color: .white, track: .white.opacity(0.25))
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Spesa mese").font(.caption).foregroundColor(.white.opacity(0.85))
                            Text(Fmt.eurCompact(totalSpent)).font(.system(.headline, design: .rounded)).foregroundColor(.white)
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("Rimanente").font(.caption).foregroundColor(.white.opacity(0.85))
                            Text(Fmt.eurCompact(remaining)).font(.system(.headline, design: .rounded)).foregroundColor(.white)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.hero, in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                // Categories
                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle(title: "Dettaglio per categoria")
                    ForEach(viewModel.data.categories, id: \.self) { category in
                        let target = budgets[category] ?? 0
                        let spent = spentByCat[category] ?? 0
                        let isOver = spent > target && target > 0
                        HStack(spacing: 10) {
                            CategoryAvatar(category: category, size: 36)
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(category).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Spacer()
                                    Text("\(Fmt.eurCompact(spent)) / \(Fmt.eurCompact(target))")
                                        .font(.caption.weight(.semibold))
                                        .foregroundColor(isOver ? Theme.danger : Theme.text2)
                                }
                                ProgressBar(value: target > 0 ? spent / target : 0,
                                            color: isOver ? Theme.danger : Theme.success, height: 6)
                            }
                        }
                    }
                }
                .card()
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Budget")
        .refreshable { await viewModel.syncData() }
    }
}
