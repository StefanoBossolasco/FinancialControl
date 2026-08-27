import SwiftUI

struct MoreTabView: View {
    var body: some View {
        NavigationView {
            List {
                NavigationLink(destination: BudgetView()) {
                    Label("Budget", systemImage: "banknote.fill")
                        .padding(.vertical, 8)
                }
                
                NavigationLink(destination: ImportView()) {
                    Label("Sincronizzazione Dati", systemImage: "cloud.fill")
                        .padding(.vertical, 8)
                }
                
                NavigationLink(destination: SettingsView()) {
                    Label("Impostazioni Profilo", systemImage: "person.crop.circle.fill")
                        .padding(.vertical, 8)
                }
            }
            .navigationTitle("Altro")
        }
    }
}
