import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var isAddSheetPresented = false

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
                            Spacer()
                            if viewModel.isSyncing {
                                ProgressView()
                                    .scaleEffect(0.8)
                            }
                        }

                        Text("€ \(viewModel.totalCurrentBalance, specifier: "%.2f")")
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
                                    Text("+€ \(inc, specifier: "%.0f")").font(.callout).fontWeight(.semibold).foregroundColor(.green)
                                }
                            }

                            HStack(spacing: 6) {
                                Image(systemName: "arrow.up.right.circle.fill")
                                    .foregroundColor(.red)
                                VStack(alignment: .leading) {
                                    Text("Uscite Mese").font(.caption2).foregroundColor(.secondary)
                                    Text("-€ \(exp, specifier: "%.0f")").font(.callout).fontWeight(.semibold).foregroundColor(.red)
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

                    // Recent Transactions List
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Ultime Transazioni")
                            .font(.headline)
                            .padding(.horizontal, 4)

                        let recent = Array(viewModel.data.transactions.prefix(5))
                        if recent.isEmpty {
                            Text("Nessuna transazione recente")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding()
                        } else {
                            ForEach(recent) { tx in
                                TransactionRowView(transaction: tx)
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .refreshable {
                await viewModel.syncFromGitHub()
            }
            .sheet(isPresented: $isAddSheetPresented) {
                AddExpenseSheet()
            }
        }
    }
}

struct TransactionRowView: View {
    let transaction: Transaction

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
                Text("\(transaction.isIncome ? "+" : "")€ \(abs(transaction.amountEUR), specifier: "%.2f")")
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
