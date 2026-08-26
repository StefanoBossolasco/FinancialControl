import SwiftUI

struct TransactionsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var searchText = ""
    @State private var selectedCategory = "Tutte"

    var filteredTransactions: [Transaction] {
        viewModel.data.transactions.filter { tx in
            let matchesSearch = searchText.isEmpty || tx.description.localizedCaseInsensitiveContains(searchText) || tx.category.localizedCaseInsensitiveContains(searchText)
            let matchesCat = selectedCategory == "Tutte" || tx.category == selectedCategory
            return matchesSearch && matchesCat
        }
    }

    var body: some View {
        NavigationView {
            VStack {
                // Category Filter Scroll Pill Bar
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterPill(title: "Tutte", isSelected: selectedCategory == "Tutte") {
                            selectedCategory = "Tutte"
                        }
                        ForEach(viewModel.data.categories, id: \.self) { cat in
                            FilterPill(title: cat, isSelected: selectedCategory == cat) {
                                selectedCategory = cat
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 8)

                // List
                List {
                    ForEach(filteredTransactions) { tx in
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
                    }
                }
                .listStyle(.plain)
            }
            .searchable(text: $searchText, prompt: "Cerca descrizione o categoria…")
            .navigationTitle("Transazioni (\(filteredTransactions.count))")
            .refreshable {
                await viewModel.syncFromGitHub()
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
