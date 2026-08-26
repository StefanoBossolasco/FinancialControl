import SwiftUI

@main
struct FinancialControlApp: App {
    @StateObject private var viewModel = FinancialViewModel()

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .environmentObject(viewModel)
                .onAppear {
                    viewModel.loadInitialData()
                }
        }
    }
}
