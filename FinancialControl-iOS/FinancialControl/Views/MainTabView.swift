import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var isAddSheetPresented = false
    @State private var selectedTab = DebugLaunch.initialTab

    var body: some View {
        ZStack(alignment: .top) {
            TabView(selection: $selectedTab) {
                DashboardView()
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }
                    .tag(0)

                TransactionsView()
                    .tabItem {
                        Label("Movimenti", systemImage: "list.bullet")
                    }
                    .tag(1)

                WalletsView()
                    .tabItem {
                        Label("Wallet", systemImage: "wallet.pass.fill")
                    }
                    .tag(2)

                AnalyticsView()
                    .tabItem {
                        Label("Analisi", systemImage: "chart.xyaxis.line")
                    }
                    .tag(3)

                MoreTabView()
                    .tabItem {
                        Label("Altro", systemImage: "ellipsis.circle.fill")
                    }
                    .tag(4)
            }
            .tint(Theme.accent)

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
