import SwiftUI

struct ImportView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Image(systemName: "cloud.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.blue)
                
                Text("Sincronizzazione Automatica")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Text("Tutti i tuoi dati sono ora sincronizzati automaticamente con Firebase in tempo reale.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
                
                Text("Per importare nuovi file (Intesa, Revolut) o file data.json, utilizza la versione Web di FinancialControl.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
                    .padding(.top, 10)
                
                Spacer()
            }
            .padding(.top, 50)
            .navigationTitle("Importa Dati")
        }
    }
}
