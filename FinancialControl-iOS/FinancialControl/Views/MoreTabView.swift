import SwiftUI

struct MoreTabView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @State private var showImport = DebugLaunch.openImport

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row(BudgetView(), "Budget", "banknote.fill", Theme.success)
                    row(ImportView(), "Importa movimenti", "square.and.arrow.down.fill", Color(hex: "#2f7bff"))
                    row(SettingsView(), "Impostazioni profilo", "person.crop.circle.fill", Color(hex: "#7a5cf5"))
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button(role: .destructive) {
                        try? viewModel.logout()
                    } label: {
                        Label("Esci", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(Theme.danger)
                    }
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Altro")
            .navigationDestination(isPresented: $showImport) { ImportView() }
        }
    }

    private func row<D: View>(_ destination: D, _ title: String, _ icon: String, _ color: Color) -> some View {
        NavigationLink(destination: destination) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(color)
                    .frame(width: 36, height: 36)
                    .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                Text(title).font(.body.weight(.medium))
            }
            .padding(.vertical, 4)
        }
    }
}
