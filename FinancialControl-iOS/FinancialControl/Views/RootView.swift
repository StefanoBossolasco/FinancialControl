import SwiftUI

/// Root view that switches between Login and the main tab interface
/// based on Firebase auth state, observed via the ViewModel.
struct RootView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    var body: some View {
        Group {
            if viewModel.isLoading && !viewModel.isLoggedIn {
                // Splash / loading while auth state is determined
                VStack(spacing: 20) {
                    ProgressView()
                        .scaleEffect(1.5)
                    Text("Caricamento…")
                        .foregroundColor(.secondary)
                }
            } else if viewModel.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.isLoggedIn)
    }
}
