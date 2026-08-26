import SwiftUI

struct LoginView: View {
    @EnvironmentObject var viewModel: FinancialViewModel

    @State private var email: String = ""
    @State private var password: String = ""
    @State private var isSignUp: Bool = false
    @State private var confirmPassword: String = ""
    @State private var isLoading: Bool = false
    @State private var errorMessage: String? = nil

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 28) {
                    // Logo
                    VStack(spacing: 12) {
                        Image(systemName: "wallet.pass.fill")
                            .font(.system(size: 56))
                            .foregroundColor(.blue)
                        Text("FinancialControl")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text(isSignUp ? "Crea il tuo account" : "Bentornato!")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 40)

                    // Form
                    VStack(spacing: 16) {
                        // Email
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Email")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("la@tua.email", text: $email)
                                .keyboardType(.emailAddress)
                                .textContentType(.emailAddress)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(10)
                        }

                        // Password
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Password")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            SecureField("La tua password", text: $password)
                                .textContentType(isSignUp ? .newPassword : .password)
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(10)
                        }

                        // Confirm password (signup only)
                        if isSignUp {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Conferma Password")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                SecureField("Ripeti la password", text: $confirmPassword)
                                    .textContentType(.newPassword)
                                    .padding()
                                    .background(Color(.secondarySystemBackground))
                                    .cornerRadius(10)
                            }
                        }

                        // Error message
                        if let err = errorMessage {
                            Text(err)
                                .font(.subheadline)
                                .foregroundColor(.red)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }

                        // Primary button
                        Button(action: handleSubmit) {
                            HStack {
                                if isLoading {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Text(isSignUp ? "Crea Account" : "Accedi")
                                        .fontWeight(.semibold)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(isLoading)

                        // Toggle sign-in / sign-up
                        Button(action: { withAnimation { isSignUp.toggle(); errorMessage = nil } }) {
                            Text(isSignUp
                                 ? "Hai già un account? Accedi"
                                 : "Non hai un account? Registrati")
                                .font(.subheadline)
                                .foregroundColor(.blue)
                        }

                        // Forgot password (login only)
                        if !isSignUp {
                            Button("Password dimenticata?") {
                                handleForgotPassword()
                            }
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 40)
            }
            .navigationBarHidden(true)
        }
    }

    // MARK: - Actions

    private func handleSubmit() {
        errorMessage = nil
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "Inserisci la tua email"; return
        }
        guard !password.isEmpty else {
            errorMessage = "Inserisci la password"; return
        }
        if isSignUp {
            guard password == confirmPassword else {
                errorMessage = "Le password non corrispondono"; return
            }
            guard password.count >= 6 else {
                errorMessage = "Password troppo corta (min 6 caratteri)"; return
            }
        }
        isLoading = true
        Task {
            do {
                if isSignUp {
                    try await viewModel.signup(email: email, password: password)
                } else {
                    try await viewModel.login(email: email, password: password)
                }
                // Auth state listener in ViewModel handles navigation
            } catch {
                errorMessage = friendlyError(error)
            }
            isLoading = false
        }
    }

    private func handleForgotPassword() {
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "Inserisci la tua email prima di richiedere il reset"; return
        }
        Task {
            do {
                try await viewModel.sendPasswordReset(email: email)
                errorMessage = nil
                viewModel.showToast("Email di reset inviata! Controlla la tua casella.")
            } catch {
                errorMessage = "Errore: \(error.localizedDescription)"
            }
        }
    }

    private func friendlyError(_ error: Error) -> String {
        let code = (error as NSError).code
        let domain = (error as NSError).domain

        if domain == "FIRAuthErrorDomain" {
            switch code {
            case 17009: return "Password errata"
            case 17011: return "Account non trovato"
            case 17007: return "Email già registrata — prova ad accedere"
            case 17008: return "Email non valida"
            case 17026: return "Password troppo debole"
            case 17004: return "Credenziali non valide"
            default: break
            }
        }
        return error.localizedDescription
    }
}
