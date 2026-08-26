import SwiftUI
import Charts

struct AnalyticsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Year Picker
                    Picker("Anno", selection: $viewModel.selectedYear) {
                        ForEach(viewModel.availableYears, id: \.self) { yr in
                            Text(String(yr)).tag(yr)
                        }
                    }
                    .pickerStyle(.segmented)
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
                        Text("Uscite vs Entrate Mese per Mese")
                            .font(.headline)

                        let monthlyItems = computeMonthlyTrend(year: viewModel.selectedYear)

                        Chart(monthlyItems) { item in
                            BarMark(
                                x: .value("Mese", item.monthLabel),
                                y: .value("Uscite", item.expenses)
                            )
                            .foregroundStyle(Color.red.opacity(0.85))
                            .cornerRadius(4)
                        }
                        .frame(height: 200)
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

    private func computeBalancePoints(year: Int) -> [BalancePoint] {
        let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        var points: [BalancePoint] = []

        let txs = viewModel.data.transactions.filter { $0.category != "__exchange__" }
        let yearTxs = txs.filter { $0.year == year }
        let monthsWithTxs = Set(yearTxs.map { $0.month })

        var lastActualMonth = 0
        for m in 1...12 {
            let k = String(format: "%04d-%02d", year, m)
            if monthsWithTxs.contains(k) { lastActualMonth = m }
        }

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
                let plannedBud = budgets.values.reduce(0, +)
                current -= plannedBud
                
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
}
