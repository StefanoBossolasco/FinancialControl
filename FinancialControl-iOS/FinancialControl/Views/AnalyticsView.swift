import SwiftUI
import Charts

struct AnalyticsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Pickers
                    HStack {
                        Picker("Anno", selection: $viewModel.selectedYear) {
                            ForEach(viewModel.availableYears, id: \.self) { yr in
                                Text(String(yr)).tag(yr)
                            }
                        }
                        .pickerStyle(.menu)
                        
                        Picker("Mese", selection: $viewModel.selectedMonth) {
                            ForEach(1...12, id: \.self) { m in
                                Text(Calendar.current.monthSymbols[m-1].capitalized).tag(m)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    .padding(.horizontal)

                    // Balance Evolution Chart with Forecast Line
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Evoluzione Saldo & Previsione Fine Anno")
                            .font(.headline)

                        let items = computeBalancePoints(year: viewModel.selectedYear)

                        Chart {
                            ForEach(items) { pt in
                                if let val = pt.realBalance {
                                    LineMark(
                                        x: .value("Mese", pt.label),
                                        y: .value("Saldo", val)
                                    )
                                    .foregroundStyle(Color.blue)
                                    .interpolationMethod(.monotone)

                                    AreaMark(
                                        x: .value("Mese", pt.label),
                                        y: .value("Saldo", val)
                                    )
                                    .foregroundStyle(LinearGradient(colors: [.blue.opacity(0.3), .blue.opacity(0.0)], startPoint: .top, endPoint: .bottom))
                                }

                                if let fVal = pt.forecastBalance {
                                    LineMark(
                                        x: .value("Mese", pt.label),
                                        y: .value("Previsione", fVal)
                                    )
                                    .foregroundStyle(Color.orange)
                                    .lineStyle(StrokeStyle(lineWidth: 2.5, dash: [6, 6]))
                                    .interpolationMethod(.monotone)
                                }
                            }
                        }
                        .frame(height: 220)
                        .padding(.top, 8)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)

                    // Monthly Income vs Expenses Chart
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Andamento Mensile — Entrate vs Uscite")
                            .font(.headline)

                        let monthlyItems = computeMonthlyTrend(year: viewModel.selectedYear)

                        Chart(monthlyItems) { item in
                            BarMark(
                                x: .value("Mese", item.monthLabel),
                                y: .value("Importo", item.expenses)
                            )
                            .foregroundStyle(Color.red.opacity(0.85))
                            .position(by: .value("Tipo", "Uscite"))

                            BarMark(
                                x: .value("Mese", item.monthLabel),
                                y: .value("Importo", item.income)
                            )
                            .foregroundStyle(Color.green.opacity(0.85))
                            .position(by: .value("Tipo", "Entrate"))
                        }
                        .chartLegend(.visible)
                        .frame(height: 200)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)
                    
                    // Spese per Categoria - Mensile
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Spese per Categoria — Mensile")
                            .font(.headline)
                        
                        let categoryItems = computeCategoryExpenses(year: viewModel.selectedYear, month: viewModel.selectedMonth)
                        
                        if categoryItems.isEmpty {
                            Text("Nessuna spesa questo mese.")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding(.top, 8)
                        } else {
                            Chart(categoryItems) { item in
                                BarMark(
                                    x: .value("Importo", item.amount),
                                    y: .value("Categoria", item.category)
                                )
                                .foregroundStyle(by: .value("Categoria", item.category))
                                .cornerRadius(4)
                            }
                            .chartLegend(.hidden)
                            .frame(height: max(200, CGFloat(categoryItems.count * 40)))
                        }
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)
                }
                .padding()
            }
            .navigationTitle("Analytics")
        }
    }

    struct BalancePoint: Identifiable {
        var id: String { label }
        let label: String
        let realBalance: Double?
        let forecastBalance: Double?
    }

    struct MonthlyTrendPoint: Identifiable {
        var id: String { monthLabel }
        let monthLabel: String
        let income: Double
        let expenses: Double
    }
    
    struct CategoryPoint: Identifiable {
        var id: String { category }
        let category: String
        let amount: Double
    }

    private func computeBalancePoints(year: Int) -> [BalancePoint] {
        let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        var points: [BalancePoint] = []

        let txs = viewModel.data.transactions.filter { $0.category != "__exchange__" }
        let yearTxs = txs.filter { $0.year == year }
        let monthsWithTxs = Set(yearTxs.map { $0.month })

        var lastActualMonth = 0
        var incSum = 0.0
        var incCount = 0

        for m in 1...12 {
            let k = String(format: "%04d-%02d", year, m)
            if monthsWithTxs.contains(k) { 
                lastActualMonth = m 
                let monthInc = yearTxs.filter { $0.month == k && $0.amountEUR > 0 }.reduce(0) { $0 + $1.amountEUR }
                if monthInc > 0 { incSum += monthInc; incCount += 1 }
            }
        }
        
        let avgIncome = incCount > 0 ? (incSum / Double(incCount)) : 0.0

        let initial = viewModel.data.settings.initialBalance ?? 0
        var current = initial + txs.filter { $0.year < year }.reduce(0) { $0 + $1.amountEUR }

        var lastRealVal: Double? = nil

        for m in 1...12 {
            let label = months[m-1]
            let k = String(format: "%04d-%02d", year, m)

            if m <= lastActualMonth && lastActualMonth > 0 {
                let monthTxs = yearTxs.filter { $0.month == k }
                let monthNet = monthTxs.reduce(0) { $0 + $1.amountEUR }
                current += monthNet
                points.append(BalancePoint(label: label, realBalance: current, forecastBalance: nil))
                if m == lastActualMonth { lastRealVal = current }
            } else {
                let budgets = viewModel.data.budgets[k] ?? viewModel.data.budgets["default"] ?? [:]
                var plannedExp = 0.0
                var budInc = 0.0
                for (cat, val) in budgets {
                    if cat == "Entrate" { budInc = val }
                    else if cat != "Trasferimenti" && cat != "__exchange__" { plannedExp += val }
                }
                
                if budInc == 0 { budInc = avgIncome }
                current += (budInc - plannedExp)
                
                let isFirstForecast = points.last?.realBalance != nil
                let fVal = current
                points.append(BalancePoint(label: label, realBalance: isFirstForecast ? lastRealVal : nil, forecastBalance: fVal))
            }
        }
        return points
    }

    private func computeMonthlyTrend(year: Int) -> [MonthlyTrendPoint] {
        let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        var points: [MonthlyTrendPoint] = []
        for m in 1...12 {
            let label = months[m-1]
            let inc = viewModel.monthlyIncome(year: year, month: m)
            let exp = viewModel.monthlyExpenses(year: year, month: m)
            points.append(MonthlyTrendPoint(monthLabel: label, income: inc, expenses: exp))
        }
        return points
    }
    
    private func computeCategoryExpenses(year: Int, month: Int) -> [CategoryPoint] {
        let monthStr = String(format: "%04d-%02d", year, month)
        let txs = viewModel.data.transactions.filter { $0.month == monthStr && $0.amountEUR < 0 && $0.category != "__exchange__" && $0.category != "Trasferimenti" }
        
        var dict: [String: Double] = [:]
        for tx in txs {
            dict[tx.category, default: 0] += abs(tx.amountEUR)
        }
        
        return dict.map { CategoryPoint(category: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }
}
