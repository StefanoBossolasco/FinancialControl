import SwiftUI
import UniformTypeIdentifiers

/// Import state: the files picked, their detected source and the merged preview rows (web S.imp)
@MainActor
final class ImportModel: ObservableObject {
    struct FileEntry: Identifiable {
        let id = UUID()
        let name: String
        let data: Data
        var detectedReason: String
        var source: ImportSource?
        var parsed: ParsedFile?
        var error: String?
    }

    @Published var files: [FileEntry] = []
    @Published var rows: [ImportRow] = []
    @Published var exchangeInfo: ExchangeInfo? = nil
    @Published var needsManualRate = false
    @Published var isReviewing = false

    var canAnalyze: Bool { !files.isEmpty && files.allSatisfy { $0.source != nil && $0.error == nil } }
    var importable: [ImportRow] { rows.filter { $0.include && $0.hasEUR && $0.tx.category != "__exchange__" } }

    func add(name: String, data: Data) {
        var entry = FileEntry(name: name, data: data, detectedReason: "", source: nil)
        do {
            let d = ImportService.detectSource(try ImportService.readTable(data))
            entry.detectedReason = d.reason
            entry.source = d.source
        } catch {
            entry.detectedReason = (error as? LocalizedError)?.errorDescription ?? "File non leggibile come CSV o Excel"
        }
        parse(&entry)
        files.append(entry)
        rows = []
    }

    func setSource(_ id: UUID, _ source: ImportSource) {
        guard let i = files.firstIndex(where: { $0.id == id }) else { return }
        files[i].source = source
        parse(&files[i])
        rows = []
    }

    func remove(_ id: UUID) {
        files.removeAll { $0.id == id }
        rows = []
    }

    func reset() {
        files = []
        rows = []
        exchangeInfo = nil
        needsManualRate = false
        isReviewing = false
    }

    private func parse(_ e: inout FileEntry) {
        e.parsed = nil
        e.error = nil
        guard let s = e.source else { return }
        do {
            let p = try ImportService.parse(s, data: e.data)
            e.parsed = p
            if p.rows.isEmpty { e.error = "Nessuna transazione valida trovata con questa fonte" }
        } catch {
            e.error = "Il file non è leggibile come \(s.label)"
        }
    }

    /// Merges all files (same id kept once per source), converts USD, suggests categories and marks duplicates
    func process(existing: [Transaction], storedRate: Double?) {
        var bySource: [ImportSource: [ImportRow]] = [:]
        var seen: [ImportSource: Set<String>] = [:]
        for f in files {
            guard let s = f.source, f.error == nil, let p = f.parsed else { continue }
            for r in p.rows where !(seen[s]?.contains(r.id) ?? false) {
                seen[s, default: []].insert(r.id)
                bySource[s, default: []].append(r)
            }
        }
        let eur = bySource[.revolutEUR] ?? [], usd = bySource[.revolutUSD] ?? []
        exchangeInfo = ImportService.matchExchanges(eur: eur.filter { $0.tx.category == "__exchange__" },
                                                    usd: usd.filter { $0.tx.category == "__exchange__" })
        let rate = exchangeInfo?.rate ?? storedRate

        var merged = eur.filter { $0.tx.category != "__exchange__" }
        var usdRows = usd.filter { $0.tx.category != "__exchange__" }
        if let rate = rate { ImportService.applyEURConversion(&usdRows, rate: rate) }
        merged += usdRows
        merged += bySource[.intesa] ?? []
        merged += bySource[.satispay] ?? []
        // Newest first, stable like the web sort
        merged = merged.enumerated().sorted { a, b in
            a.element.tx.date != b.element.tx.date ? a.element.tx.date > b.element.tx.date : a.offset < b.offset
        }.map(\.element)

        ImportService.categorize(&merged, existing: existing)
        ImportService.findDuplicates(&merged, existing: existing)
        for i in merged.indices { merged[i].include = !(merged[i].dup == .sure || merged[i].isInternal) }
        rows = merged
        needsManualRate = rate == nil && merged.contains { $0.tx.currency == "USD" }
    }

    func applyManualRate(_ rate: Double) {
        ImportService.applyEURConversion(&rows, rate: rate)
        needsManualRate = false
    }
}

struct ImportView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    @StateObject private var model = ImportModel()
    @State private var showPicker = false
    @State private var filter = 0
    @State private var manualRate = ""
    @State private var isSaving = false
    @State private var categoryRowId: String? = nil

    var body: some View {
        Group {
            if model.isReviewing { review } else { filesStep }
        }
        .screenBackground()
        .navigationTitle(model.isReviewing ? "Controlla" : "Importa")
        .navigationBarBackButtonHidden(model.isReviewing)
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(isPresented: $showPicker, allowedContentTypes: [.commaSeparatedText, .spreadsheet, .data], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let data = try? Data(contentsOf: url) { model.add(name: url.lastPathComponent, data: data) }
            }
        }
        .onAppear {
            #if DEBUG
            DebugLaunch.prepareImport(model, viewModel)
            #endif
        }
    }

    // MARK: - Step 1: files

    private var filesStep: some View {
        ScrollView {
            VStack(spacing: 14) {
                Button { showPicker = true } label: {
                    VStack(spacing: 10) {
                        Image(systemName: "doc.badge.plus")
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundColor(Theme.accent)
                            .frame(width: 64, height: 64)
                            .background(Theme.accentSoft, in: Circle())
                        Text("Scegli gli estratti conto").font(.headline).foregroundColor(Theme.text)
                        Text("Revolut (CSV), Intesa San Paolo e Satispay (Excel). La fonte viene riconosciuta dal contenuto del file.")
                            .font(.footnote).foregroundColor(Theme.text2).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 26).padding(.horizontal, 18)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                        .strokeBorder(Theme.accent.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [7, 6])))
                }
                .buttonStyle(.plain)

                ForEach(model.files) { f in fileCard(f) }

                if !model.files.isEmpty {
                    Button {
                        model.process(existing: existingSorted, storedRate: viewModel.data.exchangeRates.isEmpty ? nil : viewModel.usdPerEur)
                        withAnimation { model.isReviewing = true }
                    } label: {
                        Label("Analizza \(model.files.count) file", systemImage: "sparkles")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!model.canAnalyze)
                    .opacity(model.canAnalyze ? 1 : 0.5)
                    if !model.canAnalyze {
                        Text("Scegli la fonte dei file non riconosciuti o rimuovili.")
                            .font(.footnote).foregroundColor(Theme.text2)
                    }
                }
            }
            .padding(16)
        }
    }

    /// Existing transactions newest first, in a stable order (the web uses Data.getTransactions({}))
    private var existingSorted: [Transaction] {
        viewModel.data.transactions.sorted { $0.id < $1.id }.enumerated()
            .sorted { $0.element.date != $1.element.date ? $0.element.date > $1.element.date : $0.offset < $1.offset }
            .map(\.element)
    }

    private func fileCard(_ f: ImportModel.FileEntry) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: f.source?.icon ?? "questionmark")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(f.source == nil || f.error != nil ? Theme.warning : Theme.accent)
                .frame(width: 42, height: 42)
                .background((f.source == nil || f.error != nil ? Theme.warningSoft : Theme.accentSoft),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(f.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let e = f.error {
                    Text(e).font(.caption).foregroundColor(Theme.danger)
                } else if let p = f.parsed {
                    Text("\(p.rows.filter { $0.tx.category != "__exchange__" }.count) movimenti · \(f.detectedReason)")
                        .font(.caption).foregroundColor(Theme.text2)
                } else {
                    Text(f.detectedReason).font(.caption).foregroundColor(Theme.warning)
                }
                Menu {
                    ForEach(ImportSource.allCases) { s in
                        Button { model.setSource(f.id, s) } label: {
                            Label(s.label, systemImage: f.source == s ? "checkmark" : s.icon)
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(f.source?.label ?? "Scegli la fonte")
                        Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundColor(Theme.accentInk)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.accentSoft, in: Capsule())
                }
            }
            Spacer()
            Button { model.remove(f.id) } label: {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundColor(Theme.text3)
            }
            .accessibilityLabel("Rimuovi file")
        }
        .card(padding: 14)
    }

    // MARK: - Step 2: review

    private var shownRows: [ImportRow] {
        switch filter {
        case 1: return model.rows.filter { $0.include }
        case 2: return model.rows.filter { !$0.include }
        default: return model.rows
        }
    }

    private var review: some View {
        let toImport = model.importable
        let exp = toImport.filter { $0.tx.amountEUR < 0 }.reduce(0) { $0 + abs($1.tx.amountEUR) }
        let inc = toImport.filter { $0.tx.amountEUR >= 0 }.reduce(0) { $0 + $1.tx.amountEUR }
        let excluded = model.rows.count - model.rows.filter(\.include).count

        return List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        summaryTile("Da importare", "\(toImport.count)", Theme.text)
                        summaryTile("Uscite", Fmt.eurCompact(exp), Theme.accent)
                        summaryTile("Entrate", Fmt.eurCompact(inc), Theme.success)
                    }
                    if let info = model.exchangeInfo {
                        Label("Tasso EUR/USD \(String(format: "%.4f", info.rate)) da \(info.pairs.count) cambi", systemImage: "arrow.left.arrow.right")
                            .font(.caption.weight(.semibold)).foregroundColor(Theme.text2)
                    }
                    if excluded > 0 {
                        Label("\(excluded) righe escluse (già presenti o movimenti interni): toccale per includerle.", systemImage: "doc.on.doc")
                            .font(.caption).foregroundColor(Theme.warning)
                    }
                    if model.needsManualRate {
                        HStack {
                            TextField("Tasso USD per 1 EUR (es. 1.09)", text: $manualRate).keyboardType(.decimalPad)
                            Button("Applica") {
                                if let v = Double(manualRate.replacingOccurrences(of: ",", with: ".")), v > 0 { model.applyManualRate(v) }
                            }
                            .buttonStyle(SoftButtonStyle())
                        }
                    }
                    Picker("Mostra", selection: $filter) {
                        Text("Tutte (\(model.rows.count))").tag(0)
                        Text("Incluse").tag(1)
                        Text("Escluse (\(excluded))").tag(2)
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }

            if model.rows.isEmpty {
                EmptyStateView(icon: "doc.questionmark", title: "Niente da importare", text: "Nessuna transazione trovata nei file.")
                    .listRowBackground(Color.clear)
            }

            ForEach(groupByDay(shownRows.map(\.tx))) { group in
                Section {
                    ForEach(group.txs) { tx in
                        if let i = model.rows.firstIndex(where: { $0.id == tx.id }) { importRow(i) }
                    }
                } header: { DayHeader(group: group) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { withAnimation { model.isReviewing = false } } label: { Label("File", systemImage: "chevron.left") }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await save() }
            } label: {
                if isSaving { ProgressView().tint(.white) } else { Text("Importa \(toImport.count) transazioni") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(toImport.isEmpty || isSaving)
            .opacity(toImport.isEmpty ? 0.5 : 1)
            .padding(.horizontal, 16).padding(.bottom, 8)
        }
    }

    private func summaryTile(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2.weight(.semibold)).foregroundColor(Theme.text2)
            Text(value).font(.system(.headline, design: .rounded).weight(.bold)).foregroundColor(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 12)
    }

    private func importRow(_ i: Int) -> some View {
        let r = model.rows[i]
        return HStack(alignment: .top, spacing: 10) {
            Button { model.rows[i].include.toggle() } label: {
                Image(systemName: r.include ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(r.include ? Theme.accent : Theme.text3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(r.include ? "Escludi" : "Includi")

            CategoryAvatar(category: r.tx.category, size: 38)
            VStack(alignment: .leading, spacing: 4) {
                Text(r.tx.description).font(.subheadline.weight(.semibold)).lineLimit(1)
                Menu {
                    ForEach(viewModel.data.categories, id: \.self) { cat in
                        Button { model.rows[i].tx.category = cat } label: {
                            Label(cat, systemImage: r.tx.category == cat ? "checkmark" : CategoryStyle.icon(cat))
                        }
                    }
                } label: {
                    HStack(spacing: 3) {
                        Text(r.tx.category)
                        Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundColor(CategoryStyle.color(r.tx.category))
                }
                HStack(spacing: 5) {
                    SourceBadge(source: r.tx.source)
                    if let dup = r.dup {
                        badge(dup == .sure ? "Già presente" : "Possibile duplicato", dup == .sure ? Theme.danger : Theme.warning)
                    }
                    if r.isInternal { badge("Interno", Theme.text2) }
                    if !r.suggestLabel.isEmpty { Text(r.suggestLabel).font(.caption2).foregroundColor(Theme.text3).lineLimit(1) }
                }
                if let d = r.tx.details { Text(Fmt.shortDetails(d)).font(.caption2).foregroundColor(Theme.text3).lineLimit(1) }
                if let m = r.dupMatch, r.dup != nil {
                    Text("≈ \(m.description) · \(Fmt.date(m.date))").font(.caption2).foregroundColor(Theme.text3).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text(r.hasEUR ? Fmt.signed(r.tx.amountEUR) : "\(jsNumberString(r.tx.amount)) \(r.tx.currency)")
                .font(.system(.subheadline, design: .rounded).weight(.bold))
                .foregroundColor(r.tx.amountEUR > 0 ? Theme.success : Theme.text)
                .fixedSize()
        }
        .opacity(r.include ? 1 : 0.55)
        .listRowBackground(Theme.surface)
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }

    private func save() async {
        isSaving = true
        let txs = model.importable.map { r -> Transaction in
            var t = r.tx
            if t.category.isEmpty { t.category = "Altro" }
            return t
        }
        await viewModel.importTransactions(txs, exchangePairs: model.exchangeInfo?.pairs ?? [])
        isSaving = false
        model.reset()
    }
}
