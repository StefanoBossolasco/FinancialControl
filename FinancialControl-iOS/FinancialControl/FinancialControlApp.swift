import SwiftUI
import Firebase
import FirebaseAuth
import FirebaseFirestore

@main
struct FinancialControlApp: App {
    @StateObject private var viewModel: FinancialViewModel

    init() {
        FirebaseApp.configure()
        #if DEBUG
        // Local testing only: launch with -useFirebaseEmulator to use the Auth/Firestore emulators on localhost
        if ProcessInfo.processInfo.arguments.contains("-useFirebaseEmulator") {
            Auth.auth().useEmulator(withHost: "127.0.0.1", port: 9099)
            let settings = Firestore.firestore().settings
            settings.host = "127.0.0.1:8080"
            settings.cacheSettings = MemoryCacheSettings()
            settings.isSSLEnabled = false
            Firestore.firestore().settings = settings
        }
        #endif
        DebugLaunch.signInIfRequested()
        // Created after Firebase is configured (the view model registers an auth listener)
        _viewModel = StateObject(wrappedValue: FinancialViewModel())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(viewModel)
        }
    }
}
