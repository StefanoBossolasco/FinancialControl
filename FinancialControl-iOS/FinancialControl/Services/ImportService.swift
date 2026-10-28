import Foundation

// Port of the web app's js/import.js: Revolut CSV, Intesa San Paolo XLSX and Satispay XLSX parsing,
// source detection from the file contents, category suggestions and duplicate detection.
// Ids and rules must stay identical to the web version so both apps recognise the same rows.

/// A parsed row in the import preview. `tx` is what gets saved; the other fields are preview-only.
struct ImportRow: Identifiable {
    var tx: Transaction
    /// false while a USD row has no EUR amount yet (no exchange rate)
    var hasEUR: Bool
    var bankCat: String? = nil
    var isInternal = false
    var suggestBy: SuggestSource? = nil
    var suggestLabel = ""
    var dup: DupLevel? = nil
    var dupMatch: Transaction? = nil
    var include = true

    var id: String { tx.id }
    /// amountEUR when known, else the original amount (web amountOf)
    var amountValue: Double { hasEUR ? tx.amountEUR : tx.amount }

    enum SuggestSource { case history, bank, rules, fallback }
    enum DupLevel { case sure, maybe }
}

enum ImportSource: String, CaseIterable, Identifiable {
    case revolutEUR = "revolut_eur", revolutUSD = "revolut_usd", intesa, satispay
    var id: String { rawValue }
    var label: String {
        switch self {
        case .revolutEUR: return "Revolut EUR"
        case .revolutUSD: return "Revolut USD"
        case .intesa: return "Intesa San Paolo"
        case .satispay: return "Satispay"
        }
    }
    var icon: String {
        switch self {
        case .revolutEUR: return "eurosign"
        case .revolutUSD: return "dollarsign"
        case .intesa: return "building.columns.fill"
        case .satispay: return "iphone"
        }
    }
}

struct ParsedFile {
    var rows: [ImportRow]
    /// Revolut "Exchange" rows, used to compute the EUR/USD rate
    var exchanges: [ImportRow]
}

struct ExchangeInfo {
    struct Pair { let date: String; let eur: Double; let usd: Double; let rate: Double }
    let rate: Double
    let totalEur: Double
    let totalUsd: Double
    let pairs: [Pair]
}

enum ImportError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

enum ImportService {

    // MARK: - Category maps

    private static let intesaMap: [(String, String)] = [
        ("trasporti", "Trasporti & Mobilità"), ("noleggi", "Trasporti & Mobilità"), ("taxi", "Trasporti & Mobilità"),
        ("parcheggi", "Trasporti & Mobilità"), ("pedaggi", "Trasporti & Mobilità"), ("carburant", "Trasporti & Mobilità"),
        ("viaggi", "Viaggi & Vacanze"), ("treno", "Viaggi & Vacanze"), ("aereo", "Viaggi & Vacanze"), ("nave", "Viaggi & Vacanze"),
        ("imposte sul reddito", "Imposte & Tasse"), ("tasse varie", "Imposte & Tasse"), ("pagamento delega", "Imposte & Tasse"),
        ("imposte, bolli", "Commissioni Bancarie"), ("commissioni", "Commissioni Bancarie"), ("costo bonifico", "Commissioni Bancarie"),
        ("domiciliazioni", "Utenze & Domiciliazioni"), ("utenze", "Utenze & Domiciliazioni"),
        ("spesa alimentare", "Spesa Alimentare"), ("supermercato", "Spesa Alimentare"),
        ("ristoranti", "Ristoranti & Bar"), ("bar", "Ristoranti & Bar"), ("fast food", "Ristoranti & Bar"),
        ("tempo libero", "Intrattenimento"), ("sport", "Sport & Fitness"),
        ("salute", "Salute & Farmacia"), ("farmacia", "Salute & Farmacia"),
        ("abbigliamento", "Abbigliamento & Shopping"), ("casa e arredo", "Affitto & Casa"), ("affitto", "Affitto & Casa"),
        ("streaming", "Streaming & Abbonamenti"), ("giroconti", "Trasferimenti"), ("addebito mia carta", "Trasferimenti"),
        ("bonifici ricevuti", "Entrate"), ("stipendio", "Entrate"), ("rimborsi", "Entrate")
    ]

    private static let keywordMap: [(String, [String])] = [
        ("Affitto & Casa", ["rent", "affitto", "housing", "propane", "pasadena propane", "property"]),
        ("Spesa Alimentare", ["grocery", "supermarket", "albertsons", "vallarta", "trader joe", "whole foods", "food", "market", "deli", "kroger", "safeway", "mercato", "mercat", "supermercato", "pescheria", "macelleria", "panetteria", "panificio", "conad", "coop", "esselunga", "carrefour", "lidl", "eurospin", "penny", "despar", "naturasi"]),
        ("Ristoranti & Bar", ["restaurant", "cafe", "pizza", "burger", "starbucks", "bar", "sushi", "diner", "kitchen", "grill", "orbit", "jpl cafe", "dena burgers", "liquor", "bistro", "tavern", "caffe", "caffetteria", "pasticceria", "gelateria", "trattoria", "osteria", "ristorante", "pizzeria", "pub", "panineria", "chickfila", "chick-fil-a", "wendy", "shake shack", "taqueria", "mcdonald", "coffee"]),
        ("Trasporti & Mobilità", ["uber", "waymo", "lyft", "taxi", "parking", "amtrak", "train", "metro", "mta", "joes auto", "auto park", "transit", "bus", "subway", "trenitalia", "italo", "gtt", "apcoa", "telepass", "autostrade", "chevron", "shell", "maverik", "fastrak", "sixt", "hertz", "thrifty", "avis", "q8", "esso", "benzina"]),
        ("Viaggi & Vacanze", ["hotel", "marriott", "holiday inn", "airbnb", "southwest", "american airlines", "united", "delta", "flight", "easyjet", "ita", "south rim", "general store", "lax travel", "canyon", "resort", "motel", "booking", "edreams", "ryanair", "tours"]),
        ("Abbigliamento & Shopping", ["zara", "h&m", "fashion", "clothes", "clothing", "shoes", "gap", "forever21", "nordstrom", "target"]),
        ("Streaming & Abbonamenti", ["netflix", "spotify", "apple", "amazon prime", "discoveryplus", "youtube", "hulu", "disney", "origin financial", "paramount"]),
        ("Shopping Online", ["amazon", "ebay", "etsy", "shopify", "alibaba"]),
        ("Imposte & Tasse", ["tax", "f24", "imposte", "tasse", "pagamento delega", "irs"]),
        ("Commissioni Bancarie", ["fee", "commission", "costo bonifico", "bolli", "bank charge"]),
        ("Trasferimenti", ["transfer to", "transfer from", "bonifico", "addebito diretto"]),
        ("Sport & Fitness", ["gym", "fitness", "sport", "palestra", "yoga", "equinox"]),
        ("Salute & Farmacia", ["pharmacy", "farmacia", "medical", "doctor", "hospital", "dentist", "cvs", "walgreens", "rite aid"]),
        ("Intrattenimento", ["movie", "cinema", "concert", "show", "dodger", "stadium", "theme park", "dj", "wild west", "disneyland", "spo dj", "junctions"]),
        ("Utenze & Domiciliazioni", ["electricity", "gas", "water", "internet", "phone", "paypal", "utility"])
    ]

    /// Keywords match at the start of a word, so "gas" doesn't match "Las Vegas"
    private static let keywordRegexes: [(String, [NSRegularExpression])] = keywordMap.map { cat, kws in
        (cat, kws.map { try! NSRegularExpression(pattern: "(^|[^a-z0-9])" + NSRegularExpression.escapedPattern(for: $0)) })
    }

    static func suggestCategory(_ description: String) -> String {
        let low = stripAccents(description.lowercased())
        let range = NSRange(low.startIndex..., in: low)
        for (cat, rxs) in keywordRegexes where rxs.contains(where: { $0.firstMatch(in: low, range: range) != nil }) {
            return cat
        }
        return "Altro"
    }

    static func mapIntesaCategory(_ raw: String) -> String {
        let low = raw.lowercased().trimmingCharacters(in: .whitespaces)
        return intesaMap.first { low.contains($0.0) }?.1 ?? "Altro"
    }

    // MARK: - Ids

    /// FNV-1a over UTF-16 code units, reproducing JavaScript's number arithmetic exactly
    /// (the product is a double, then `>>> 0`), so ids equal the web genId().
    static func genId(_ date: String, _ amount: Double, _ description: String) -> String {
        let s = "\(date)|\(jsNumberString(amount))|\(description)"
        var h: Double = 2_166_136_261
        for unit in s.utf16 {
            let x = Int32(truncatingIfNeeded: UInt32(h)) ^ Int32(unit)   // JS `^` works on int32
            h = toUint32(Double(x) * 16_777_619)
        }
        return String(UInt32(h), radix: 36)
    }

    private static func toUint32(_ v: Double) -> Double {
        let two32 = 4_294_967_296.0
        var m = v.rounded(.towardZero).truncatingRemainder(dividingBy: two32)
        if m < 0 { m += two32 }
        return m
    }

    /// Identical rows in one file get "-2", "-3" suffixes (deterministic across re-imports)
    static func uniqueIds(_ rows: inout [ImportRow]) {
        var seen: [String: Int] = [:]
        for i in rows.indices {
            let id = rows[i].tx.id
            if let n = seen[id] {
                seen[id] = n + 1
                rows[i].tx = rows[i].tx.with(id: "\(id)-\(n + 1)")
            } else {
                seen[id] = 1
            }
        }
    }

    // MARK: - Text normalisation

    static func stripAccents(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for u in s.decomposedStringWithCanonicalMapping.unicodeScalars where !(0x300...0x36F).contains(u.value) {
            out.append(u)
        }
        return String(out)
    }

    private static let stopwords = Set(("effettuato il alle ore mediante la carta presso ctv di usd eur al cambio ora " +
        "autorizzazione pagamento pagamenti effettuata su pos estero addebito diretto disposto disposta a favore da voi " +
        "bonifico istantaneo sepa srl spa sas snc sarl et cie sca mandato cod disp nome the and of at com www " +
        "in per del della dei e n xxxx xx to from by transfer payment money sent received").split(separator: " ").map(String.init))
    private static let processorPrefixes: Set<String> = ["sq", "tst", "fh", "tcb", "sp", "pp", "paypal", "sumup", "zettle", "izettle"]

    static func tokens(_ text: String) -> [String] {
        let low = stripAccents(text).lowercased()
        var words: [String] = []
        var cur = ""
        for u in low.unicodeScalars {
            if (u.value >= 97 && u.value <= 122) || (u.value >= 48 && u.value <= 57) { cur.unicodeScalars.append(u) }
            else if !cur.isEmpty { words.append(cur); cur = "" }
        }
        if !cur.isEmpty { words.append(cur) }
        var toks = words.filter { $0.count >= 2 && !$0.contains(where: \.isNumber) && !stopwords.contains($0) }
        while toks.count > 1, processorPrefixes.contains(toks[0]) { toks.removeFirst() }
        return toks
    }

    private static func tokEq(_ a: String, _ b: String) -> Bool {
        if a == b { return true }
        if a.count < 4 || b.count < 4 { return false }
        return a.hasPrefix(b) || b.hasPrefix(a)
    }

    private static func tokenSimilarity(_ a: [String], _ b: [String]) -> Double {
        if a.isEmpty || b.isEmpty { return 0 }
        let (short, long) = a.count <= b.count ? (a, b) : (b, a)
        let hits = short.filter { x in long.contains { tokEq(x, $0) } }.count
        return Double(hits) / Double(short.count)
    }

    private static let pressoRx = try! NSRegularExpression(pattern: "\\bpresso\\s+(.+?)(?:\\s*\\(ctv\\..*)?$", options: [.caseInsensitive])

    /// Intesa card rows: the merchant is after "presso", before "(ctv. di … usd …)"
    static func merchantFromDetails(_ details: String?) -> String {
        guard let d = details, !d.isEmpty,
              let m = pressoRx.firstMatch(in: d, range: NSRange(d.startIndex..., in: d)),
              let r = Range(m.range(at: 1), in: d) else { return "" }
        return String(d[r]).trimmingCharacters(in: .whitespaces)
    }

    static func merchantText(_ t: Transaction) -> String {
        [t.description, merchantFromDetails(t.details)].filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: - Category suggestions

    private struct Counts {
        var order: [String] = []
        var n: [String: Int] = [:]
        mutating func add(_ cat: String) {
            if n[cat] == nil { order.append(cat) }
            n[cat, default: 0] += 1
        }
        /// Most frequent category; ties go to the first one seen (like the web bestOf)
        var best: (category: String, count: Int, total: Int) {
            var b = "", c = 0, total = 0
            for cat in order { let k = n[cat]!; total += k; if k > c { b = cat; c = k } }
            return (b, c, total)
        }
    }

    private struct CategoryIndex {
        var oneOrder: [String] = []
        var one: [String: Counts] = [:]
        var two: [String: Counts] = [:]
    }

    private static func sign(_ amount: Double) -> String { amount < 0 ? "-" : "+" }

    private static func buildIndex(_ existing: [Transaction]) -> CategoryIndex {
        var idx = CategoryIndex()
        for t in existing where !["Altro", "__exchange__", ""].contains(t.category) {
            let toks = tokens(merchantText(t))
            guard let first = toks.first else { continue }
            let k1 = sign(t.amountEUR) + first
            if idx.one[k1] == nil { idx.oneOrder.append(k1); idx.one[k1] = Counts() }
            idx.one[k1]!.add(t.category)
            if toks.count > 1 { idx.two[sign(t.amountEUR) + first + " " + toks[1], default: Counts()].add(t.category) }
        }
        return idx
    }

    private static func lookupHistory(_ idx: CategoryIndex, _ r: ImportRow) -> (category: String, count: Int, total: Int)? {
        let toks = tokens(merchantText(r.tx))
        guard let first = toks.first else { return nil }
        let s = sign(r.amountValue)
        if toks.count > 1, let c = idx.two[s + first + " " + toks[1]] { return c.best }
        if let exact = idx.one[s + first], first.count >= 3 { return exact.best }
        if first.count >= 5 {
            for key in idx.oneOrder where key.hasPrefix(s) && key.count >= 6 && tokEq(String(key.dropFirst()), first) {
                return idx.one[key]!.best
            }
        }
        return nil
    }

    /// Your past transactions first, then the bank's category, then keyword rules
    static func categorize(_ rows: inout [ImportRow], existing: [Transaction]) {
        let idx = buildIndex(existing)
        for i in rows.indices where rows[i].tx.category != "__exchange__" {
            if let h = lookupHistory(idx, rows[i]), !h.category.isEmpty, Double(h.count) / Double(h.total) >= 0.6 {
                rows[i].tx.category = h.category
                rows[i].suggestBy = .history
                rows[i].suggestLabel = "Storico \(h.count)/\(h.total)"
                continue
            }
            if !rows[i].tx.category.isEmpty && rows[i].tx.category != "Altro" {
                rows[i].suggestBy = .bank
                rows[i].suggestLabel = rows[i].bankCat.map { "Banca: \($0)" } ?? "Regola fonte"
                continue
            }
            let text = [merchantText(rows[i].tx), rows[i].tx.details ?? "", rows[i].bankCat ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
            let rule = suggestCategory(text)
            if rule != "Altro" {
                rows[i].tx.category = rule
                rows[i].suggestBy = .rules
                rows[i].suggestLabel = "Parole chiave"
                continue
            }
            rows[i].tx.category = rows[i].amountValue > 0 ? "Entrate" : "Altro"
            rows[i].suggestBy = .fallback
            rows[i].suggestLabel = "Nessuna regola"
        }
    }

    // MARK: - Duplicates

    private static func dayNumber(_ ymd: String) -> Double {
        guard let d = utcDay.date(from: ymd) else { return .nan }
        return d.timeIntervalSince1970 / 86_400
    }

    private static let utcDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// "sure": same id, or same amount, date within 2 days and similar text.
    /// "maybe": same amount and date ±1 day but different text. Each existing row matches one import row.
    static func findDuplicates(_ rows: inout [ImportRow], existing: [Transaction]) {
        let byId = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var used = Set<String>()
        var byAmount: [Int: [Transaction]] = [:]
        for e in existing { byAmount[Int((abs(e.amountEUR) * 100).rounded()), default: []].append(e) }

        for i in rows.indices {
            rows[i].dup = nil
            rows[i].dupMatch = nil
            if let e = byId[rows[i].tx.id] {
                rows[i].dup = .sure
                rows[i].dupMatch = e
                used.insert(e.id)
            }
        }

        for i in rows.indices where rows[i].dup == nil && rows[i].tx.category != "__exchange__" {
            let t = rows[i]
            let amt = t.amountValue
            let cands = byAmount[Int((abs(amt) * 100).rounded())] ?? []
            let tToks = tokens(merchantText(t.tx) + " " + (t.tx.details ?? ""))
            let tDay = dayNumber(t.tx.date)
            var best: (e: Transaction, sim: Double, days: Double)? = nil
            var bestScore = -1.0
            for e in cands where !used.contains(e.id) {
                if (e.amountEUR < 0) != (amt < 0) { continue }
                if !t.hasEUR && e.currency != t.tx.currency { continue }
                let days = abs(dayNumber(e.date) - tDay)
                if !(days <= 2) { continue }
                let sim = tokenSimilarity(tToks, tokens(merchantText(e) + " " + (e.details ?? "")))
                let score = sim - days * 0.1
                if score > bestScore { best = (e, sim, days); bestScore = score }
            }
            guard let b = best else { continue }
            if b.sim >= 0.5 { rows[i].dup = .sure } else if b.days <= 1 { rows[i].dup = .maybe }
            if rows[i].dup != nil {
                rows[i].dupMatch = b.e
                used.insert(b.e.id)
            }
        }
    }

    // MARK: - Source detection (rules documented in js/import.js above SOURCES)

    struct Table {
        var kind: FileKind
        var rows: [[String]]
        var sheetNames: [String]
    }

    private static let headerScanRows = 60

    static func readTable(_ data: Data) throws -> Table {
        switch sniffKind(data) {
        case .xls:
            throw SpreadsheetError.unsupportedXLS
        case .xlsx:
            let wb = try XLSXReader.read(data, maxRows: headerScanRows)
            return Table(kind: .xlsx, rows: wb.rows.map { $0.map(\.string) }, sheetNames: wb.sheetNames)
        case .csv:
            let text = String(decoding: data, as: UTF8.self)
            return Table(kind: .csv, rows: Array(CSVReader.rows(text.trimmingCharacters(in: .whitespacesAndNewlines)).prefix(headerScanRows)), sheetNames: [])
        }
    }

    private static func norm(_ c: String) -> String {
        stripAccents(c).replacingOccurrences(of: "\u{FEFF}", with: "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    static func detectSource(_ table: Table) -> (source: ImportSource?, reason: String) {
        let rows = table.rows.prefix(headerScanRows).map { $0.map(norm) }
        func has(_ h: [String], _ names: String...) -> Bool { names.contains { h.contains($0) } }
        func hasPrefix(_ h: [String], _ names: String...) -> Bool { h.contains { c in names.contains { c.hasPrefix($0) } } }

        for (i, h) in rows.enumerated() {
            if has(h, "amount", "importo") && has(h, "currency", "valuta") && has(h, "state", "stato") &&
                has(h, "started date", "completed date", "product", "prodotto", "data di inizio", "data inizio") {
                let curCol = h.firstIndex { $0 == "currency" || $0 == "valuta" } ?? 0
                var counts: [String: Int] = [:]
                var order: [String] = []
                for r in rows.dropFirst(i + 1) where curCol < r.count {
                    let cur = r[curCol].uppercased()
                    guard !cur.isEmpty else { continue }
                    if counts[cur] == nil { order.append(cur) }
                    counts[cur, default: 0] += 1
                }
                // Majority, first seen wins a tie (stable sort like the web)
                let cur = order.max { counts[$0]! < counts[$1]! || (counts[$0]! == counts[$1]! && order.firstIndex(of: $0)! > order.firstIndex(of: $1)!) } ?? "EUR"
                if cur == "EUR" { return (.revolutEUR, "Colonne Revolut, valuta EUR") }
                if cur == "USD" { return (.revolutUSD, "Colonne Revolut, valuta USD") }
                return (nil, "Estratto Revolut in \(cur): sono supportati solo EUR e USD")
            }
            if has(h, "date", "data") && has(h, "amount", "importo") && has(h, "name", "nome") && has(h, "type", "tipo") &&
                (has(h, "status", "stato") || hasPrefix(h, "id", "balance after", "saldo dopo")) {
                return (.satispay, "Colonne Satispay (Name, Type, Status, ID)")
            }
            if h.contains("data") && h.contains("importo") && h.contains("operazione") &&
                (has(h, "dettagli", "conto o carta", "contabilizzazione") || hasPrefix(h, "categoria")) {
                return (.intesa, "Tabella \"Lista Operazione\" Intesa")
            }
        }

        let sheets = table.sheetNames.map(norm)
        if sheets.first == "transactions" && sheets.contains("legend") {
            return (.satispay, "Fogli \"Transactions\" e \"Legend\" di Satispay")
        }

        let flat = rows.map { $0.joined(separator: " ") }
        let preamble = flat.contains { $0.hasPrefix("conti e carte") } || flat.contains { $0.hasPrefix("data inizio periodo") }
        if preamble && rows.contains(where: { hasPrefix($0, "data") && hasPrefix($0, "importo", "entrate", "uscite") }) {
            return (.intesa, "Intestazione conto Intesa")
        }
        return (nil, "Formato non riconosciuto")
    }

    static func parse(_ source: ImportSource, data: Data) throws -> ParsedFile {
        switch source {
        case .revolutEUR, .revolutUSD:
            let table: [[String]]
            switch sniffKind(data) {
            case .xls: throw SpreadsheetError.unsupportedXLS
            case .xlsx: table = try XLSXReader.read(data).rows.map { $0.map(\.string) }
            case .csv: table = CSVReader.rows(String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
            }
            return parseRevolut(table, currency: source == .revolutUSD ? "USD" : "EUR")
        case .intesa:
            guard sniffKind(data) == .xlsx else { throw ImportError.message("Il file Intesa deve essere un .xlsx") }
            return ParsedFile(rows: try parseIntesa(try XLSXReader.read(data).rows), exchanges: [])
        case .satispay:
            let rows: [[Cell]]
            switch sniffKind(data) {
            case .xls: throw SpreadsheetError.unsupportedXLS
            case .xlsx: rows = try XLSXReader.read(data).rows
            case .csv: rows = CSVReader.rows(String(decoding: data, as: UTF8.self)).map { $0.map { $0.isEmpty ? Cell.empty : Cell.text($0) } }
            }
            return ParsedFile(rows: try parseSatispay(rows), exchanges: [])
        }
    }

    // MARK: - Shared row builder

    private static let importedAt = { ISO8601DateFormatter.withFractionalSeconds.string(from: Date()) }

    private static func makeRow(id: String, date: String, description: String, amount: Double, currency: String,
                                amountEUR: Double?, category: String, source: String, type: String, balance: Double,
                                details: String?) -> ImportRow {
        let tx = Transaction(id: id, date: date, month: String(date.prefix(7)), year: Int(date.prefix(4)) ?? 0,
                             description: description, amount: amount, currency: currency, amountEUR: amountEUR ?? 0,
                             category: category, source: source, type: type, balance: balance, importedAt: importedAt(),
                             notes: "", details: details)
        return ImportRow(tx: tx, hasEUR: amountEUR != nil)
    }

    // MARK: - Revolut CSV

    static func parseRevolut(_ table: [[String]], currency: String) -> ParsedFile {
        guard let header = table.first else { return ParsedFile(rows: [], exchanges: []) }
        let keys = header.map { $0.replacingOccurrences(of: "\u{FEFF}", with: "").trimmingCharacters(in: .whitespaces).lowercased() }
        func val(_ r: [String], _ names: String...) -> String? {
            for n in names { if let i = keys.firstIndex(of: n.lowercased()), i < r.count { return r[i] } }
            return nil
        }
        var rows: [ImportRow] = []
        var exchanges: [ImportRow] = []
        for r in table.dropFirst() {
            let state = (val(r, "State", "Stato", "Status") ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            if !state.isEmpty && !["COMPLETED", "PENDING", "COMPLETATA", "IN SOSPESO", "ESEGUITO", "RECORDED"].contains(state) { continue }

            let rawAmount = (val(r, "Amount", "Importo", "Value") ?? "").filter { !$0.isWhitespace }
            guard let amount = parseFloatJS(rawAmount.replacingFirst(",", with: ".")) else { continue }
            let rawDate = (val(r, "Started Date", "Date", "Data inizio", "Data", "Started_Date") ?? "").trimmingCharacters(in: .whitespaces)
            let date = String(rawDate.split(separator: " ").first ?? "")
            guard !date.isEmpty, utcDay.date(from: date) != nil else { continue }

            let description = (val(r, "Description", "Descrizione", "Details") ?? "").jsPrefix(120)
            let rowCurrency = (val(r, "Currency", "Valuta").flatMap { $0.isEmpty ? nil : $0 } ?? currency).trimmingCharacters(in: .whitespaces).uppercased()
            let type = (val(r, "Type", "Tipo") ?? "").trimmingCharacters(in: .whitespaces)
            let balance = parseFloatJS((val(r, "Balance", "Saldo").flatMap { $0.isEmpty ? nil : $0 } ?? "0").replacingFirst(",", with: ".")) ?? 0

            var row = makeRow(id: genId(date, amount, description), date: date, description: description, amount: amount,
                              currency: rowCurrency, amountEUR: rowCurrency == "EUR" || currency == "EUR" ? amount : nil,
                              category: "", source: rowCurrency == "EUR" ? "revolut_eur" : "revolut_usd", type: type,
                              balance: balance, details: nil)
            let lowDesc = description.lowercased()
            if type.lowercased() == "exchange" || lowDesc.contains("exchanged to") || lowDesc.contains("cambio") {
                row.tx.category = "__exchange__"
                rows.append(row)
                continue
            }
            if type.lowercased() == "transfer" && amount < 0 { row.tx.category = "Trasferimenti" }
            else if amount > 0 { row.tx.category = "Entrate" }
            if !type.isEmpty { row.bankCat = type }
            rows.append(row)
        }
        uniqueIds(&rows)
        exchanges = rows.filter { $0.tx.category == "__exchange__" }
        return ParsedFile(rows: rows, exchanges: exchanges)
    }

    // MARK: - Intesa XLSX

    static func parseIntesa(_ rows: [[Cell]]) throws -> [ImportRow] {
        let lowRows = rows.map { $0.map { $0.string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } }
        var headerIdx = lowRows.firstIndex { r in
            let s = r.joined(separator: " ")
            return s.contains("data") && (s.contains("importo") || s.contains("descrizione") || s.contains("operazione") || s.contains("categoria"))
        }
        if headerIdx == nil { headerIdx = lowRows.firstIndex { $0.contains { $0.contains("data") } } }
        if headerIdx == nil { headerIdx = lowRows.firstIndex { $0.contains { $0.contains("importo") } } }
        if headerIdx == nil { headerIdx = lowRows.firstIndex { $0.contains { !$0.isEmpty } } }
        guard let hi = headerIdx else {
            throw ImportError.message("Intestazione della tabella (\"Data\", \"Importo\", etc.) non trovata nel file Intesa.")
        }

        let header = lowRows[hi]
        var dateCol = header.firstIndex { $0.hasPrefix("data") } ?? -1
        var descCol = header.firstIndex { $0.contains("descrizione") || $0.contains("causale") || $0.contains("operazione") } ?? -1
        var catCol = header.firstIndex { $0.contains("categoria") } ?? -1
        var amtCol = header.firstIndex { $0.contains("importo") || $0.contains("entrate") || $0.contains("uscite") } ?? -1
        let detCol = header.firstIndex { $0.contains("dettagli") } ?? -1
        if dateCol < 0 { dateCol = 0 }
        if descCol < 0 { descCol = 1 }
        if catCol < 0 { catCol = 5 }
        if amtCol < 0 { amtCol = 7 }

        func cell(_ r: [Cell], _ i: Int) -> Cell { i >= 0 && i < r.count ? r[i] : .empty }

        var out: [ImportRow] = []
        for r in rows.dropFirst(hi + 1) {
            if cell(r, dateCol).isEmpty && cell(r, amtCol).isEmpty { continue }

            let amount: Double
            switch cell(r, amtCol) {
            case .number(let n): amount = n
            default:
                guard let a = parseFloatJS(cell(r, amtCol).string.replacingOccurrences(of: ".", with: "").replacingFirst(",", with: ".")) else { continue }
                amount = a
            }

            var date: String
            switch cell(r, dateCol) {
            case .number(let n):
                guard let d = excelSerialToDate(n) else { continue }
                date = d
            default:
                let s = cell(r, dateCol).string.trimmingCharacters(in: .whitespaces)
                let parts = s.split(whereSeparator: { "/-.".contains($0) }).map(String.init)
                if parts.count == 3 {
                    date = parts[0].count == 4
                        ? "\(parts[0])-\(parts[1].leftPad(2))-\(parts[2].leftPad(2))"
                        : "\(parts[2])-\(parts[1].leftPad(2))-\(parts[0].leftPad(2))"
                } else {
                    date = s
                }
            }
            guard utcDay.date(from: date) != nil else { continue }

            let operation = cell(r, descCol).string.trimmingCharacters(in: .whitespacesAndNewlines).jsPrefix(120)
            let rawCat = cell(r, catCol).string.trimmingCharacters(in: .whitespacesAndNewlines)
            var details = detCol >= 0
                ? cell(r, detCol).string.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
                : ""
            if details.range(of: "^n\\.?d\\.?$", options: [.regularExpression, .caseInsensitive]) != nil || details.lowercased() == operation.lowercased() {
                details = ""
            }

            // Generic "Pagamento ... Pos" operations hide the merchant: show it as the description.
            // The id keeps using the bank's operation text so earlier imports still match.
            var description = operation
            let merchant = merchantFromDetails(details)
            if !merchant.isEmpty, operation.range(of: "^pagamento\\b.*\\bpos\\b", options: [.regularExpression, .caseInsensitive]) != nil {
                description = merchant.jsPrefix(120)
            }

            var row = makeRow(id: genId(date, amount, operation), date: date, description: description, amount: amount,
                              currency: "EUR", amountEUR: amount, category: mapIntesaCategory(rawCat), source: "intesa",
                              type: operation.jsPrefix(50), balance: 0, details: details.isEmpty ? nil : details.jsPrefix(500))
            if !rawCat.isEmpty { row.bankCat = rawCat }
            out.append(row)
        }
        uniqueIds(&out)
        return out
    }

    // MARK: - Satispay XLSX / CSV

    /// Movements between Satispay and your own bank or money boxes: excluded by default
    private static let satispayInternal = try! NSRegularExpression(
        pattern: "savings|money box|salvadanaio|investment|investiment|to bank|from bank|verso banca|da banca|ricarica", options: .caseInsensitive)

    private static func matches(_ rx: NSRegularExpression, _ s: String) -> Bool {
        rx.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private static let satispayDateRx = try! NSRegularExpression(pattern: "^(\\d{1,4})[/\\-.](\\d{1,2})[/\\-.](\\d{2,4})")

    /// Type/Status values start with an emoji
    private static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "^[^\\p{L}\\p{N}]+", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func parseSatispay(_ rows: [[Cell]]) throws -> [ImportRow] {
        let lowRows = rows.map { $0.map { $0.string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } }
        guard let hi = lowRows.firstIndex(where: { h in
            h.contains { $0 == "date" || $0 == "data" } && h.contains { $0 == "amount" || $0 == "importo" }
        }) else { throw ImportError.message("Intestazione Satispay (\"Date\", \"Amount\", …) non trovata.") }

        let header = lowRows[hi]
        func col(_ names: String...) -> Int { header.firstIndex { c in names.contains { c == $0 || c.hasPrefix($0) } } ?? -1 }
        let dateCol = col("date", "data"), nameCol = col("name", "nome"), descCol = col("description", "descrizione")
        let amtCol = col("amount", "importo"), typeCol = col("type", "tipo"), statCol = col("status", "stato"), idCol = col("id")
        func cell(_ r: [Cell], _ i: Int) -> Cell { i >= 0 && i < r.count ? r[i] : .empty }

        var out: [ImportRow] = []
        for r in rows.dropFirst(hi + 1) {
            if cell(r, dateCol).isEmpty || cell(r, amtCol).isEmpty { continue }
            let status = clean(cell(r, statCol).string)
            if status.range(of: "cancel|annull|rifiut|fail|declin", options: [.regularExpression, .caseInsensitive]) != nil { continue }

            var amount: Double
            switch cell(r, amtCol) {
            case .number(let n): amount = n
            default:
                var s = cell(r, amtCol).string.filter { $0 != "€" && !$0.isWhitespace }
                if s.contains(",") { s = s.replacingOccurrences(of: ".", with: "").replacingFirst(",", with: ".") }
                guard let a = parseFloatJS(s) else { continue }
                amount = a
            }
            if amount == 0 { continue }
            amount = (amount * 100 + 0.5).rounded(.down) / 100   // JS Math.round

            let date: String
            switch cell(r, dateCol) {
            case .number(let n):
                guard let d = excelSerialToDate(n) else { continue }
                date = d
            default:
                let s = cell(r, dateCol).string.trimmingCharacters(in: .whitespaces)
                guard let m = satispayDateRx.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { continue }
                let g = (1...3).map { Range(m.range(at: $0), in: s).map { String(s[$0]) } ?? "" }
                let (y, mo, d) = g[0].count == 4 ? (Int(g[0])!, Int(g[1])!, Int(g[2])!) : (Int(g[2])!, Int(g[1])!, Int(g[0])!)
                var cal = Calendar(identifier: .gregorian)
                cal.timeZone = TimeZone(identifier: "UTC")!
                // Same overflow behaviour as new Date(y, m - 1, d)
                guard let dt = cal.date(from: DateComponents(year: y, month: mo, day: d)) else { continue }
                date = utcDay.string(from: dt)
            }

            let name = cell(r, nameCol).string.trimmingCharacters(in: .whitespacesAndNewlines)
            let note = descCol >= 0 ? cell(r, descCol).string.trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let type = clean(cell(r, typeCol).string)
            let spId = idCol >= 0 ? cell(r, idCol).string.trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let description = (name.isEmpty ? (type.isEmpty ? "Satispay" : type) : name).jsPrefix(120)
            let details = [type, note, !status.isEmpty && status != "Approved" ? status : ""].filter { !$0.isEmpty }.joined(separator: " · ")

            var category = ""
            let isInternal = matches(satispayInternal, type)
            if isInternal { category = "Trasferimenti" }
            else if type.range(of: "cashback|reward|points|punti|premio", options: [.regularExpression, .caseInsensitive]) != nil { category = "Entrate" }

            let id = spId.isEmpty
                ? genId(date, amount, "satispay|\(description)")
                : "sp-" + spId.filter { ($0.isASCII && ($0.isLetter || $0.isNumber)) || $0 == "-" }
            var row = makeRow(id: id, date: date, description: description, amount: amount, currency: "EUR", amountEUR: amount,
                              category: category, source: "satispay", type: type.jsPrefix(50), balance: 0,
                              details: details.isEmpty ? nil : details.jsPrefix(500))
            if !type.isEmpty { row.bankCat = type }
            row.isInternal = isInternal
            out.append(row)
        }
        uniqueIds(&out)
        return out
    }

    // MARK: - Exchange rates

    static func matchExchanges(eur: [ImportRow], usd: [ImportRow]) -> ExchangeInfo? {
        guard !eur.isEmpty, !usd.isEmpty else { return nil }
        var pairs: [ExchangeInfo.Pair] = []
        var totalEur = 0.0, totalUsd = 0.0
        for e in eur where e.tx.amount < 0 {
            let spent = abs(e.tx.amount)
            guard let u = usd.first(where: { $0.tx.amount > 0 && abs(dayNumber($0.tx.date) - dayNumber(e.tx.date)) <= 2 }) else { continue }
            pairs.append(.init(date: e.tx.date, eur: spent, usd: u.tx.amount, rate: u.tx.amount / spent))
            totalEur += spent
            totalUsd += u.tx.amount
        }
        guard !pairs.isEmpty, totalEur > 0 else { return nil }
        return ExchangeInfo(rate: totalUsd / totalEur, totalEur: totalEur, totalUsd: totalUsd, pairs: pairs)
    }

    /// USD rows without an EUR amount get amount / rate, rounded to cents (toFixed(2))
    static func applyEURConversion(_ rows: inout [ImportRow], rate: Double) {
        for i in rows.indices where rows[i].tx.currency == "USD" && !rows[i].hasEUR {
            rows[i].tx.amountEUR = Double(String(format: "%.2f", rows[i].tx.amount / rate)) ?? rows[i].tx.amount / rate
            rows[i].hasEUR = true
        }
    }

    // MARK: - Helpers

    /// parseFloat-like: leading number in the string, nil when there is none
    static func parseFloatJS(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard let r = t.range(of: "^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?", options: .regularExpression) else { return nil }
        return Double(t[r])
    }
}

extension Transaction {
    func with(id newId: String) -> Transaction {
        Transaction(id: newId, date: date, month: month, year: year, description: description, amount: amount,
                    currency: currency, amountEUR: amountEUR, category: category, source: source, type: type,
                    balance: balance, importedAt: importedAt, notes: notes, details: details, walletId: walletId)
    }
}

extension String {
    func replacingFirst(_ target: String, with replacement: String) -> String {
        guard let r = range(of: target) else { return self }
        return replacingCharacters(in: r, with: replacement)
    }

    /// First n UTF-16 code units, like JavaScript's substring(0, n)
    func jsPrefix(_ n: Int) -> String {
        guard utf16.count > n else { return self }
        return String(decoding: Array(utf16.prefix(n)), as: UTF16.self)
    }

    func leftPad(_ n: Int) -> String { count >= n ? self : String(repeating: "0", count: n - count) + self }
}
