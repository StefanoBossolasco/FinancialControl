import Foundation
import Compression

// Minimal readers for bank exports: .xlsx (zip + XML) and CSV, no third-party dependencies.
// Rows are returned like SheetJS `sheet_to_json(ws, { header: 1, defval: '' })`, which the web parsers use.

enum Cell: Equatable {
    case empty
    case text(String)
    case number(Double)

    /// String form as JavaScript's String(value) would give it
    var string: String {
        switch self {
        case .empty: return ""
        case .text(let s): return s
        case .number(let n): return jsNumberString(n)
        }
    }

    var isEmpty: Bool {
        if case .empty = self { return true }
        if case .text(let s) = self { return s.isEmpty }
        return false
    }
}

/// Number → string the way JavaScript prints it ("-15.5", "100"), used in generated ids
func jsNumberString(_ n: Double) -> String {
    if n.isNaN { return "NaN" }
    if n == n.rounded(), abs(n) < 1e21 { return String(Int64(n)) }
    return "\(n)"
}

struct Workbook {
    var sheetNames: [String]
    /// First sheet only (the web app reads only the first one too)
    var rows: [[Cell]]
}

enum SpreadsheetError: LocalizedError {
    case notZip, missing(String), corrupt, unsupportedXLS

    var errorDescription: String? {
        switch self {
        case .notZip, .corrupt: return "File Excel non leggibile"
        case .missing(let f): return "File Excel incompleto (\(f) mancante)"
        case .unsupportedXLS: return "Il formato .xls (Excel 97) non è supportato su iOS: esporta in .xlsx o CSV"
        }
    }
}

// MARK: - Format sniffing (same rule as the web readImportTable)

enum FileKind { case xlsx, xls, csv }

func sniffKind(_ data: Data) -> FileKind {
    let b = [UInt8](data.prefix(4))
    if b == [0x50, 0x4B, 0x03, 0x04] { return .xlsx }
    if b == [0xD0, 0xCF, 0x11, 0xE0] { return .xls }
    return .csv
}

// MARK: - ZIP

struct ZipArchive {
    private let bytes: [UInt8]
    private var entries: [String: (method: UInt16, compSize: Int, size: Int, localOffset: Int)] = [:]

    init(_ data: Data) throws {
        bytes = [UInt8](data)
        guard bytes.count >= 22 else { throw SpreadsheetError.notZip }
        // End of central directory, scanning back over a possible comment
        var eocd = -1
        var i = bytes.count - 22
        while i >= max(0, bytes.count - 65_557) {
            if u32(i) == 0x0605_4b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw SpreadsheetError.notZip }
        let count = Int(u16(eocd + 10))
        var p = Int(u32(eocd + 16))
        for _ in 0..<count {
            guard p + 46 <= bytes.count, u32(p) == 0x0201_4b50 else { throw SpreadsheetError.corrupt }
            let method = u16(p + 10)
            let compSize = Int(u32(p + 20))
            let size = Int(u32(p + 24))
            let nameLen = Int(u16(p + 28)), extraLen = Int(u16(p + 30)), commentLen = Int(u16(p + 32))
            let local = Int(u32(p + 42))
            guard p + 46 + nameLen <= bytes.count else { throw SpreadsheetError.corrupt }
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            entries[name] = (method, compSize, size, local)
            p += 46 + nameLen + extraLen + commentLen
        }
    }

    func has(_ name: String) -> Bool { entries[name] != nil }

    func file(_ name: String) throws -> Data {
        guard let e = entries[name] else { throw SpreadsheetError.missing(name) }
        let p = e.localOffset
        guard p + 30 <= bytes.count, u32(p) == 0x0403_4b50 else { throw SpreadsheetError.corrupt }
        let start = p + 30 + Int(u16(p + 26)) + Int(u16(p + 28))
        guard start + e.compSize <= bytes.count else { throw SpreadsheetError.corrupt }
        let src = Array(bytes[start..<(start + e.compSize)])
        switch e.method {
        case 0:
            return Data(src)
        case 8:
            // COMPRESSION_ZLIB is raw DEFLATE, which is what zip entries use
            var dst = [UInt8](repeating: 0, count: max(e.size, 1))
            let n = compression_decode_buffer(&dst, dst.count, src, src.count, nil, COMPRESSION_ZLIB)
            guard n == e.size else { throw SpreadsheetError.corrupt }
            return Data(dst.prefix(n))
        default:
            throw SpreadsheetError.corrupt
        }
    }

    private func u16(_ o: Int) -> UInt16 { UInt16(bytes[o]) | UInt16(bytes[o + 1]) << 8 }
    private func u32(_ o: Int) -> UInt32 {
        UInt32(bytes[o]) | UInt32(bytes[o + 1]) << 8 | UInt32(bytes[o + 2]) << 16 | UInt32(bytes[o + 3]) << 24
    }
}

// MARK: - XLSX

enum XLSXReader {
    static func read(_ data: Data, maxRows: Int? = nil) throws -> Workbook {
        let zip = try ZipArchive(data)

        // Sheet order and paths from the workbook and its relationships
        let wbXML = try zip.file("xl/workbook.xml")
        let sheets = XMLScan.elements(wbXML, named: "sheet")
        let rels = zip.has("xl/_rels/workbook.xml.rels")
            ? XMLScan.elements(try zip.file("xl/_rels/workbook.xml.rels"), named: "Relationship") : []
        var targets: [String: String] = [:]
        for r in rels { if let id = r["Id"], let t = r["Target"] { targets[id] = t } }

        let names = sheets.compactMap { $0["name"] }
        guard let first = sheets.first else { return Workbook(sheetNames: [], rows: []) }
        var path = "xl/worksheets/sheet1.xml"
        if let rid = first["r:id"] ?? first.first(where: { $0.key.hasSuffix(":id") })?.value, let t = targets[rid] {
            path = t.hasPrefix("/") ? String(t.dropFirst()) : "xl/" + t
        }

        let shared = zip.has("xl/sharedStrings.xml") ? SharedStringsParser.parse(try zip.file("xl/sharedStrings.xml")) : []
        let rows = SheetParser.parse(try zip.file(path), shared: shared, maxRows: maxRows)
        return Workbook(sheetNames: names, rows: rows)
    }
}

/// Collects the attributes of every element with a given name
private final class XMLScan: NSObject, XMLParserDelegate {
    private let name: String
    private var found: [[String: String]] = []
    private init(name: String) { self.name = name }

    static func elements(_ data: Data, named name: String) -> [[String: String]] {
        let d = XMLScan(name: name)
        let p = XMLParser(data: data)
        p.delegate = d
        p.parse()
        return d.found
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes: [String: String] = [:]) {
        if elementName == name || elementName.hasSuffix(":" + name) { found.append(attributes) }
    }
}

private final class SharedStringsParser: NSObject, XMLParserDelegate {
    private var strings: [String] = []
    private var current = ""
    private var inT = false
    private var phonetic = 0

    static func parse(_ data: Data) -> [String] {
        let d = SharedStringsParser()
        let p = XMLParser(data: data)
        p.delegate = d
        p.parse()
        return d.strings
    }

    func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        switch e {
        case "si": current = ""
        case "t": inT = phonetic == 0
        case "rPh": phonetic += 1
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        switch e {
        case "si": strings.append(current)
        case "t": inT = false
        case "rPh": phonetic -= 1
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters s: String) {
        if inT { current += s }
    }
}

private final class SheetParser: NSObject, XMLParserDelegate {
    private let shared: [String]
    private let maxRows: Int?
    private var cells: [(row: Int, col: Int, cell: Cell)] = []
    private var origin = (row: 0, col: 0)
    private var rowIndex = 0
    private var nextCol = 0
    private var col = 0
    private var type = ""
    private var value = ""
    private var collecting = false

    private init(shared: [String], maxRows: Int?) {
        self.shared = shared
        self.maxRows = maxRows
    }

    static func parse(_ data: Data, shared: [String], maxRows: Int?) -> [[Cell]] {
        let d = SheetParser(shared: shared, maxRows: maxRows)
        let p = XMLParser(data: data)
        p.delegate = d
        p.parse()
        return d.table()
    }

    /// Rows from the sheet's range start, missing cells as .empty (sheet_to_json header:1, defval:'')
    private func table() -> [[Cell]] {
        guard !cells.isEmpty else { return [] }
        let r0 = min(origin.row, cells.map(\.row).min()!)
        let c0 = min(origin.col, cells.map(\.col).min()!)
        let rMax = cells.map(\.row).max()!, cMax = cells.map(\.col).max()!
        var out = Array(repeating: Array(repeating: Cell.empty, count: cMax - c0 + 1), count: rMax - r0 + 1)
        for c in cells { out[c.row - r0][c.col - c0] = c.cell }
        if let m = maxRows { return Array(out.prefix(m)) }
        return out
    }

    /// "AB12" → (row 11, col 27), zero-based
    static func ref(_ s: String) -> (row: Int, col: Int)? {
        var col = 0, row = 0, sawDigit = false
        for ch in s.uppercased() {
            if let a = ch.asciiValue, a >= 65, a <= 90, !sawDigit { col = col * 26 + Int(a - 64) }
            else if let d = ch.wholeNumberValue { row = row * 10 + d; sawDigit = true }
            else { return nil }
        }
        guard col > 0, row > 0 else { return nil }
        return (row - 1, col - 1)
    }

    func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String] = [:]) {
        switch e {
        case "dimension":
            if let r = a["ref"]?.split(separator: ":").first, let o = Self.ref(String(r)) { origin = o }
        case "row":
            if let m = maxRows, rowIndex - origin.row >= m { parser.abortParsing(); return }
            if let r = a["r"], let n = Int(r) { rowIndex = n - 1 } else { rowIndex += 1 }
            nextCol = 0
        case "c":
            if let r = a["r"], let p = Self.ref(r) { col = p.col } else { col = nextCol }
            nextCol = col + 1
            type = a["t"] ?? "n"
            value = ""
        case "v", "t":
            collecting = true
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        switch e {
        case "v", "t":
            collecting = false
        case "c":
            let cell: Cell
            switch type {
            case "s":
                if let i = Int(value), i >= 0, i < shared.count { cell = shared[i].isEmpty ? .empty : .text(shared[i]) } else { cell = .empty }
            case "str", "inlineStr", "e", "d":
                cell = value.isEmpty ? .empty : .text(value)
            case "b":
                cell = .text(value == "1" ? "TRUE" : "FALSE")
            default:
                if let n = Double(value) { cell = .number(n) } else { cell = value.isEmpty ? .empty : .text(value) }
            }
            if cell != .empty { cells.append((rowIndex, col, cell)) }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters s: String) {
        if collecting { value += s }
    }
}

// MARK: - CSV (RFC 4180, comma separated, quotes doubled)

enum CSVReader {
    static func rows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var it = Array(text.unicodeScalars)
        if it.first == "\u{FEFF}" { it.removeFirst() }
        var i = 0
        while i < it.count {
            let c = it[i]
            if inQuotes {
                if c == "\"" {
                    if i + 1 < it.count, it[i + 1] == "\"" { field.unicodeScalars.append("\""); i += 1 } else { inQuotes = false }
                } else {
                    field.unicodeScalars.append(c)
                }
            } else if c == "\"" {
                inQuotes = true
            } else if c == "," {
                row.append(field); field = ""
            } else if c == "\n" || c == "\r" {
                if c == "\r", i + 1 < it.count, it[i + 1] == "\n" { i += 1 }
                row.append(field); field = ""
                rows.append(row); row = []
            } else {
                field.unicodeScalars.append(c)
            }
            i += 1
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        // skipEmptyLines
        return rows.filter { !($0.count == 1 && $0[0].isEmpty) }
    }
}

// MARK: - Excel dates

/// Excel serial day number (1900 system) → "yyyy-MM-dd"; time of day is dropped
func excelSerialToDate(_ serial: Double) -> String? {
    guard serial >= 1, serial < 2_958_466 else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let base = cal.date(from: DateComponents(year: 1899, month: 12, day: 30))!
    guard let d = cal.date(byAdding: .day, value: Int(serial.rounded(.down)), to: base) else { return nil }
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}
