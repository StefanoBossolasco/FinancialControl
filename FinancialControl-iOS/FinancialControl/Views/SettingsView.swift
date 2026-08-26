import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    @State private var initialBalanceText: String = "0"
    @State private var currentPw: String = ""
    @State private var newPw: String = ""
    @State private var confirmPw: String = ""

    var body: some View {
        NavigationView {
            Form {
                // MARK: - Account
                Section(header: Text("Account Firebase")) {
                    HStack {
                        Text("Email")
                        Spacer()
                        Text(viewModel.currentUser?.email ?? "—")
                            .foregroundColor(.secondary)
                            .font(.subheadline)
                    }

                    Button(role: .destructive, action: {
                        try? viewModel.logout()
                    }) {
                        Label("Esci dall'account", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                // MARK: - Cambio password
                Section(header: Text("Cambia Password")) {
                    SecureField("Password attuale", text: $currentPw)
                    SecureField("Nuova password", text: $newPw)
                    SecureField("Conferma nuova password", text: $confirmPw)

                    Button("Aggiorna Password") {
                        guard !currentPw.isEmpty, !newPw.isEmpty, newPw == confirmPw else {
                            viewModel.showToast("Controlla i campi password")
                            return
                        }
                        Task {
                            do {
                                try await viewModel.changePassword(currentPw: currentPw, newPw: newPw)
                                currentPw = ""
                                newPw = ""
                                confirmPw = ""
                            } catch {
                                viewModel.showToast("Errore: \(error.localizedDescription)")
                            }
                        }
                    }
                    .disabled(currentPw.isEmpty || newPw.isEmpty || confirmPw.isEmpty)
                }

                // MARK: - Saldo iniziale
                Section(header: Text("Saldo Iniziale")) {
                    HStack {
                        Text("Saldo iniziale (€)")
                        Spacer()
                        TextField("0", text: $initialBalanceText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 120)
                    }

                    Button("Salva Saldo Iniziale") {
                        if let val = Double(initialBalanceText.replacingOccurrences(of: ",", with: ".")) {
                            viewModel.updateInitialBalance(val)
                        }
                    }
                }

                // MARK: - Stato connessione
                Section(header: Text("Stato Connessione")) {
                    HStack {
                        Text("Transazioni sincronizzate")
                        Spacer()
                        Text("\(viewModel.data.transactions.count)")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Sincronizzazione Firebase attiva")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Impostazioni")
            .onAppear {
                if let initial = viewModel.data.settings.initialBalance {
                    initialBalanceText = String(format: "%.2f", initial)
                }
            }
        }
    }
}
