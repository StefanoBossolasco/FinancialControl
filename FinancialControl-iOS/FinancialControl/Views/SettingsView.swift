import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    @State private var owner: String = ""
    @State private var repo: String = ""
    @State private var branch: String = "main"
    @State private var path: String = "data.json"
    @State private var patToken: String = ""
    @State private var initialBalanceText: String = "0"

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Sincronizzazione GitHub"), footer: Text("Inserisci il tuo Personal Access Token (PAT) di GitHub per sincronizzare istantaneamente data.json con l'app Web.")) {
                    HStack {
                        Text("Owner")
                        Spacer()
                        TextField("StefanoBossolasco", text: $owner)
                            .multilineTextAlignment(.trailing)
                    }

                    HStack {
                        Text("Repo")
                        Spacer()
                        TextField("FinancialControl", text: $repo)
                            .multilineTextAlignment(.trailing)
                    }

                    HStack {
                        Text("PAT Token")
                        Spacer()
                        SecureField("ghp_…", text: $patToken)
                            .multilineTextAlignment(.trailing)
                    }

                    Button(action: saveSettings) {
                        HStack {
                            Spacer()
                            Text("Salva & Synchronizza")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                }

                Section(header: Text("Saldo Iniziale")) {
                    HStack {
                        Text("Saldo iniziale (€)")
                        Spacer()
                        TextField("0", text: $initialBalanceText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }

                    Button("Aggiorna Saldo Iniziale") {
                        if let val = Double(initialBalanceText.replacingOccurrences(of: ",", with: ".")) {
                            viewModel.data.settings.initialBalance = val
                            viewModel.saveToCache()
                            Task {
                                await viewModel.pushToGitHub(message: "Update initial balance from iOS")
                            }
                        }
                    }
                }

                Section(header: Text("Stato Connessione")) {
                    HStack {
                        Text("Transazioni in memoria")
                        Spacer()
                        Text("\(viewModel.data.transactions.count)")
                            .foregroundColor(.secondary)
                    }

                    Button(action: {
                        Task {
                            await viewModel.syncFromGitHub()
                        }
                    }) {
                        HStack {
                            Image(systemName: "arrow.triangle.2.circlepath")
                            Text("Forza Sincronizzazione")
                        }
                    }
                }
            }
            .navigationTitle("Impostazioni")
            .onAppear {
                owner = viewModel.owner
                repo = viewModel.repo
                branch = viewModel.branch
                path = viewModel.path
                patToken = viewModel.patToken
                if let initial = viewModel.data.settings.initialBalance {
                    initialBalanceText = String(initial)
                }
            }
        }
    }

    private func saveSettings() {
        viewModel.saveConfig(
            owner: owner,
            repo: repo,
            branch: branch,
            path: path,
            patToken: patToken
        )
    }
}
