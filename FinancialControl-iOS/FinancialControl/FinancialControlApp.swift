import SwiftUI
import Firebase

@main
struct FinancialControlApp: App {
    @StateObject private var viewModel = FinancialViewModel()

    init() {
        FirebaseApp.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(viewModel)
        }
    }
}
