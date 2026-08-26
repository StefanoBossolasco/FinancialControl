import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var isAddSheetPresented = false

    var body: some View {
        ZStack(alignment: .top) {
            TabView {
                DashboardView()
                    .tabItem {
                        Label("Dashboard", systemImage: "square.grid.2x2.fill")
                    }

                BudgetView()
                    .tabItem {
                        Label("Budget", systemImage: "banknote.fill")
                    }

                ImportView()
                    .tabItem {
                        Label("Importa", systemImage: "square.and.arrow.down.fill")
                    }

                TransactionsView()
                    .tabItem {
                        Label("Transazioni", systemImage: "creditcard.fill")
                    }

                AnalyticsView()
                    .tabItem {
                        Label("Analytics", systemImage: "chart.xyaxis.line")
                    }

                SettingsView()
                    .tabItem {
                        Label("Impostazioni", systemImage: "gearshape.fill")
                    }
            }
            .accentColor(.blue)

            // Toast Alert Banner
            if let toast = viewModel.toastMessage {
                Text(toast)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.black.opacity(0.85)))
                    .padding(.top, 50)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(10)
            }
        }
    }
}
