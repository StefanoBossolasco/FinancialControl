import Foundation
import FirebaseAuth

/// Launch arguments for testing in the Simulator against the local Firebase emulators.
/// Everything here is a no-op in Release builds and without -useFirebaseEmulator.
enum DebugLaunch {
    private static var defaults: UserDefaults { .standard }

    /// Appends to Documents/debug-launch.log (read it with `simctl get_app_container ... data`)
    static func log(_ line: String) {
        guard isEmulator,
              let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let url = dir.appendingPathComponent("debug-launch.log")
        let data = Data("\(Date()) \(line)\n".utf8)
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(data)
            try? h.close()
        } else {
            try? data.write(to: url)
        }
    }

    static var isEmulator: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-useFirebaseEmulator")
        #else
        return false
        #endif
    }

    /// -tab N selects the initial tab
    static var initialTab: Int { isEmulator ? defaults.integer(forKey: "tab") : 0 }

    /// -openWallet <id> opens that wallet's detail on the Wallet tab
    static var initialWalletPath: [String] {
        guard isEmulator, let id = defaults.string(forKey: "openWallet") else { return [] }
        return [id]
    }

    /// -emulatorEmail / -emulatorPassword sign in to the Auth emulator at launch
    static func signInIfRequested() {
        #if DEBUG
        log("args=\(ProcessInfo.processInfo.arguments.dropFirst().joined(separator: " ").replacingOccurrences(of: defaults.string(forKey: "emulatorPassword") ?? "\u{0}", with: "***")) user=\(Auth.auth().currentUser?.uid ?? "nil")")
        #endif
        guard isEmulator, Auth.auth().currentUser == nil,
              let email = defaults.string(forKey: "emulatorEmail"),
              let password = defaults.string(forKey: "emulatorPassword") else { return }
        Task {
            do {
                try await Auth.auth().signIn(withEmail: email, password: password)
                log("signed in to emulator")
            } catch {
                log("sign-in failed: \(error)")
            }
        }
    }

    /// -walletScript create|delete runs wallet operations through the view model, logging each step
    @MainActor
    static func afterLoad(_ vm: FinancialViewModel) {
        guard isEmulator, let script = defaults.string(forKey: "walletScript") else { return }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            switch script {
            case "create":
                let id = vm.saveWallet(id: "w_iostest", name: "Test iOS", amount: 100, color: "#bf5af2",
                                       startDate: "2026-10-01", endDate: nil, notes: "creato da iOS")
                let picks = vm.data.transactions
                    .filter { $0.walletId == nil && $0.amountEUR < 0 && $0.month == "2026-06" }
                    .sorted { $0.id < $1.id }.prefix(2).map(\.id)
                vm.assignWallet(txIds: Set(picks), walletId: id)
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                vm.saveWallet(id: id, name: "Test iOS", amount: 120, color: "#bf5af2",
                              startDate: "2026-10-01", endDate: nil, notes: "modificato da iOS")
                vm.addTransaction(description: "Spesa iOS nel wallet", amountEUR: -30, category: "Altro",
                                  source: "other", date: Date(), notes: "", walletId: id)
                if var tx = vm.data.transactions.first(where: { $0.id == "oct5" }) {
                    tx.category = "Intrattenimento"
                    tx.walletId = id
                    vm.updateTransaction(tx)
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if let st = vm.walletStats(id: id) {
                    log("WALLETSCRIPT stats allocated=\(st.allocated) spent=\(st.spent) credits=\(st.credits) remaining=\(st.remaining) txs=\(st.txs.count) status=\(st.status) picks=\(picks)")
                }
            case "delete":
                vm.deleteWallet(id: "w_iostest")
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                log("WALLETSCRIPT deleted; left=\(vm.data.transactions.filter { $0.walletId == "w_iostest" }.count)")
            default:
                break
            }
        }
    }

    /// -openImport opens the import screen from the Altro tab
    static var openImport: Bool { isEmulator && defaults.bool(forKey: "openImport") }

    /// -importFiles a,b,c loads files from the Mac's filesystem into the import screen;
    /// -importAnalyze YES goes to the review; -importDump YES writes the rows to Documents/import-dump.json;
    /// -importSave YES saves them
    @MainActor
    static func prepareImport(_ model: ImportModel, _ vm: FinancialViewModel) {
        guard isEmulator, model.files.isEmpty, let list = defaults.string(forKey: "importFiles") else { return }
        for path in list.split(separator: ",").map(String.init) {
            if let data = FileManager.default.contents(atPath: path) {
                model.add(name: (path as NSString).lastPathComponent, data: data)
            } else {
                log("IMPORT cannot read \(path)")
            }
        }
        for f in model.files { log("IMPORT file \(f.name) source=\(f.source?.rawValue ?? "nil") reason=\(f.detectedReason) error=\(f.error ?? "-") rows=\(f.parsed?.rows.count ?? 0)") }
        guard defaults.bool(forKey: "importAnalyze") else { return }
        Task { @MainActor in
            // Wait for the transactions to load
            for _ in 0..<40 where vm.data.transactions.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
            let existing = vm.data.transactions.sorted { $0.id < $1.id }.enumerated()
                .sorted { $0.element.date != $1.element.date ? $0.element.date > $1.element.date : $0.offset < $1.offset }
                .map(\.element)
            model.process(existing: existing, storedRate: vm.data.exchangeRates.isEmpty ? nil : vm.usdPerEur)
            model.isReviewing = true
            log("IMPORT analyzed rows=\(model.rows.count) importable=\(model.importable.count) rate=\(model.exchangeInfo?.rate ?? 0)")
            if defaults.bool(forKey: "importDump") {
                let dump = model.rows.map { r -> [String: Any] in
                    ["id": r.tx.id, "date": r.tx.date, "description": r.tx.description, "amount": r.tx.amount,
                     "amountEUR": r.hasEUR ? r.tx.amountEUR : NSNull(), "category": r.tx.category, "source": r.tx.source,
                     "type": r.tx.type, "details": r.tx.details ?? NSNull(), "dup": r.dup.map { $0 == .sure ? "sure" : "maybe" } ?? NSNull(),
                     "dupMatch": r.dupMatch?.id ?? NSNull(), "internal": r.isInternal, "include": r.include,
                     "suggest": r.suggestLabel]
                }
                if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
                   let json = try? JSONSerialization.data(withJSONObject: dump, options: [.prettyPrinted, .sortedKeys]) {
                    try? json.write(to: dir.appendingPathComponent("import-dump.json"))
                }
            }
            if defaults.bool(forKey: "importSave") {
                let n = await vm.importTransactions(model.importable.map { r in
                    var t = r.tx
                    if t.category.isEmpty { t.category = "Altro" }
                    return t
                }, exchangePairs: model.exchangeInfo?.pairs ?? [])
                log("IMPORT saved \(n)")
            }
        }
    }
}
