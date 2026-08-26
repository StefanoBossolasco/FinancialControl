import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var showDocumentPicker = false
    @State private var importError: String? = nil
    @State private var importSuccess: String? = nil
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Hero section
                    VStack(spacing: 12) {
                        Image(systemName: "square.and.arrow.down.fill")
                            .font(.system(size: 52))
                            .foregroundColor(.blue)
                        
                        Text("Importa Dati")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        Text("Carica il file data.json esportato dalla versione web di FinancialControl, oppure sincronizza direttamente via GitHub dalle Impostazioni.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top, 20)
                    
                    // Import from JSON file
                    GroupBox(label: Label("Importa da File JSON", systemImage: "doc.fill")) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Seleziona un file data.json esportato dall'app web. I dati esistenti verranno sostituiti.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Button(action: { showDocumentPicker = true }) {
                                HStack {
                                    Spacer()
                                    Image(systemName: "folder.fill")
                                    Text("Scegli File JSON")
                                        .fontWeight(.semibold)
                                    Spacer()
                                }
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            
                            if let error = importError {
                                HStack {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundColor(.red)
                                    Text(error)
                                        .font(.caption)
                                        .foregroundColor(.red)
                                }
                                .padding(8)
                                .background(Color.red.opacity(0.1))
                                .cornerRadius(8)
                            }
                            
                            if let success = importSuccess {
                                HStack {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.green)
                                    Text(success)
                                        .font(.caption)
                                        .foregroundColor(.green)
                                }
                                .padding(8)
                                .background(Color.green.opacity(0.1))
                                .cornerRadius(8)
                            }
                        }
                        .padding()
                    }
                    .padding(.horizontal)
                    
                    // GitHub Sync info
                    GroupBox(label: Label("Sincronizzazione GitHub", systemImage: "arrow.triangle.2.circlepath")) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("La sincronizzazione via GitHub mantiene i tuoi dati aggiornati tra l'app web e l'app iOS. Configura il token PAT nelle Impostazioni.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Button(action: {
                                Task {
                                    await viewModel.syncData()
                                }
                            }) {
                                HStack {
                                    Spacer()
                                    if viewModel.isLoading {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Image(systemName: "arrow.triangle.2.circlepath")
                                    }
                                    Text(viewModel.isLoading ? "Sincronizzazione..." : "Sincronizza da GitHub")
                                        .fontWeight(.semibold)
                                    Spacer()
                                }
                                .padding()
                                .background(Color.green)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            .disabled(viewModel.isLoading || viewModel.patToken.isEmpty)
                            
                            if viewModel.patToken.isEmpty {
                                Label("Token PAT non configurato — vai in Impostazioni", systemImage: "exclamationmark.circle")
                                    .font(.caption)
                                    .foregroundColor(.orange)
                            }
                        }
                        .padding()
                    }
                    .padding(.horizontal)
                    
                    // Stats attuali
                    GroupBox(label: Label("Dati in Memoria", systemImage: "cylinder.fill")) {
                        VStack(spacing: 8) {
                            StatRow(label: "Transazioni totali", value: "\(viewModel.data.transactions.count)")
                            StatRow(label: "Anni disponibili", value: viewModel.availableYears.map { String($0) }.joined(separator: ", "))
                            StatRow(label: "Ultima sync", value: "—")
                        }
                        .padding()
                    }
                    .padding(.horizontal)
                    
                    // Istruzioni
                    GroupBox(label: Label("Come funziona", systemImage: "questionmark.circle.fill")) {
                        VStack(alignment: .leading, spacing: 8) {
                            InstructionRow(number: "1", text: "Apri l'app web su browser e vai in Impostazioni → Esporta Dati")
                            InstructionRow(number: "2", text: "Salva il file data.json sul tuo iPhone (Files o iCloud)")
                            InstructionRow(number: "3", text: "Torna qui e tocca 'Scegli File JSON' per importarlo")
                            InstructionRow(number: "4", text: "In alternativa configura GitHub per sincronizzazione automatica")
                        }
                        .padding()
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Importa")
            .sheet(isPresented: $showDocumentPicker) {
                JSONDocumentPicker { url in
                    importJSONFile(from: url)
                }
            }
        }
    }
    
    private func importJSONFile(from url: URL) {
        importError = nil
        importSuccess = nil
        
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            let financialData = try decoder.decode(FinancialData.self, from: data)
            viewModel.data = financialData
            viewModel.saveToCache()
            importSuccess = "\(financialData.transactions.count) transazioni importate con successo!"
            viewModel.showToast("Dati importati!")
        } catch {
            importError = "Errore: \(error.localizedDescription)"
        }
    }
}

// MARK: - Helper Views
struct StatRow: View {
    let label: String
    let value: String
    
    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
        }
    }
}

struct InstructionRow: View {
    let number: String
    let text: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 22, height: 22)
                .background(Color.blue)
                .clipShape(Circle())
            
            Text(text)
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Document Picker
struct JSONDocumentPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.json, UTType.data], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            onPick(url)
        }
    }
}
