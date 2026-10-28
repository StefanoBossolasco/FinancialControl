import SwiftUI
import UIKit

// MARK: - Colours
// Same tokens as the web app (css/styles.css), each with a light and a dark value.

extension UIColor {
    /// "#rrggbb" or "#rrggbbaa"
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let hasAlpha = s.count == 8
        let r = CGFloat((v >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let g = CGFloat((v >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let b = CGFloat((v >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let a = hasAlpha ? CGFloat(v & 0xff) / 255 : 1
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}

extension Color {
    init(hex: String) { self.init(UIColor(hex: hex)) }

    static func dynamic(_ light: String, _ dark: String) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    /// Wallet colours are stored as "#rrggbb"; anything else falls back to blue like the web app
    static func wallet(_ hex: String?) -> Color {
        guard let hex = hex, hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else {
            return Color(hex: "#0a84ff")
        }
        return Color(hex: hex)
    }
}

enum Theme {
    static let accent      = Color.dynamic("#f23a4c", "#ff4b5c")
    static let accentSoft  = Color.dynamic("#feecee", "#ff4b5c26")
    static let accentInk   = Color.dynamic("#d0263a", "#ff7f8b")
    static let bg          = Color.dynamic("#f5f5f7", "#0e0e11")
    static let surface     = Color.dynamic("#ffffff", "#18181d")
    static let surface2    = Color.dynamic("#f1f1f4", "#222229")
    static let surface3    = Color.dynamic("#e7e7ec", "#2d2d35")
    static let text        = Color.dynamic("#15151c", "#f4f4f6")
    static let text2       = Color.dynamic("#676776", "#a3a3b0")
    static let text3       = Color.dynamic("#9b9ba8", "#6f6f7c")
    static let success     = Color.dynamic("#11a46a", "#2fd08a")
    static let successSoft = Color.dynamic("#e3f6ec", "#2fd08a24")
    static let danger      = Color.dynamic("#e3363b", "#ff5c5c")
    static let dangerSoft  = Color.dynamic("#fdeaea", "#ff5c5c24")
    static let warning     = Color.dynamic("#e98500", "#ffad42")
    static let warningSoft = Color.dynamic("#fff2de", "#ffad4224")

    static let hero = LinearGradient(
        colors: [Color.dynamic("#ff6a5c", "#f25a4f"), Color.dynamic("#f23a4c", "#e0334a"), Color.dynamic("#e3285f", "#c4245a")],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    static let cardRadius: CGFloat = 24
}

// MARK: - Formatting

enum Fmt {
    private static let it = Locale(identifier: "it_IT")

    private static func currency(_ digits: Int) -> NumberFormatter {
        let f = NumberFormatter()
        f.locale = it
        f.numberStyle = .currency
        f.currencyCode = "EUR"
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        return f
    }
    private static let eur2 = currency(2)
    private static let eur0 = currency(0)

    /// "1.234,56 €"
    static func eur(_ v: Double) -> String { eur2.string(from: NSNumber(value: v)) ?? "\(v) €" }
    /// "1.235 €"
    static func eurCompact(_ v: Double) -> String { eur0.string(from: NSNumber(value: v)) ?? "\(v) €" }
    /// "−12,50 €" / "+35,00 €"
    static func signed(_ v: Double) -> String { (v < 0 ? "−" : "+") + eur(abs(v)) }

    private static let shortDate: DateFormatter = {
        let f = DateFormatter()
        f.locale = it
        f.dateFormat = "dd MMM yyyy"
        return f
    }()
    /// "2026-10-28" → "28 ott 2026"
    static func date(_ ymd: String) -> String {
        guard let d = Transaction.dayFormatter.date(from: ymd) else { return ymd }
        return shortDate.string(from: d)
    }

    private static let weekday: DateFormatter = {
        let f = DateFormatter()
        f.locale = it
        f.dateFormat = "EEEE d MMMM"
        return f
    }()
    private static let weekdayYear: DateFormatter = {
        let f = DateFormatter()
        f.locale = it
        f.dateFormat = "EEEE d MMMM yyyy"
        return f
    }()
    /// "Oggi", "Ieri", "venerdì 24 ottobre"
    static func dayLabel(_ ymd: String) -> String {
        guard let d = Transaction.dayFormatter.date(from: ymd) else { return ymd }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Oggi" }
        if cal.isDateInYesterday(d) { return "Ieri" }
        let sameYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        return (sameYear ? weekday : weekdayYear).string(from: d)
    }

    static func monthName(_ month: Int) -> String {
        let f = DateFormatter()
        f.locale = it
        return f.standaloneMonthSymbols[month - 1].capitalized
    }

    /// Bank details without long reference codes, like the web app's shortDetails()
    static func shortDetails(_ details: String) -> String {
        var s = details.replacingOccurrences(of: "(?<!@)\\b(?=[A-Za-z]*\\d)[A-Za-z0-9]{10,}\\b", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "^\\s*COD\\.?\\s*DISP\\.?", with: "", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return String(s.prefix(90))
    }
}

// MARK: - Category style (colour + icon), same palette as the web charts

enum CategoryStyle {
    private static let styles: [String: (String, String)] = [
        "Affitto & Casa":           ("#7a5cf5", "house.fill"),
        "Spesa Alimentare":         ("#16a86c", "cart.fill"),
        "Ristoranti & Bar":         ("#ff8a3d", "fork.knife"),
        "Trasporti & Mobilità":     ("#2f7bff", "bus.fill"),
        "Viaggi & Vacanze":         ("#14b5c9", "airplane"),
        "Abbigliamento & Shopping": ("#e6467e", "bag.fill"),
        "Salute & Farmacia":        ("#f23a4c", "heart.fill"),
        "Sport & Fitness":          ("#20b26b", "dumbbell.fill"),
        "Streaming & Abbonamenti":  ("#9b51e0", "tv.fill"),
        "Utenze & Domiciliazioni":  ("#f2a90f", "bolt.fill"),
        "Imposte & Tasse":          ("#5c6b80", "building.columns.fill"),
        "Commissioni Bancarie":     ("#8a8f98", "percent"),
        "Intrattenimento":          ("#ff5fa2", "ticket.fill"),
        "Trasferimenti":            ("#3a8fd9", "arrow.left.arrow.right"),
        "Entrate":                  ("#11a46a", "arrow.down.left"),
        "Altro":                    ("#8a8a96", "ellipsis")
    ]
    private static let extra = ["#f23a4c", "#ff8a3d", "#f2a90f", "#16a86c", "#14b5c9", "#2f7bff", "#7a5cf5", "#e6467e", "#5c6b80", "#20b26b"]

    static func hex(_ category: String) -> String {
        if let s = styles[category] { return s.0 }
        var h: UInt32 = 0
        for u in category.unicodeScalars { h = h &* 31 &+ u.value }
        return extra[Int(h % UInt32(extra.count))]
    }
    static func color(_ category: String) -> Color { Color(hex: hex(category)) }
    static func icon(_ category: String) -> String { styles[category]?.1 ?? "tag.fill" }
}

// MARK: - Building blocks

struct CardModifier: ViewModifier {
    var padding: CGFloat = 18
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .shadow(color: .black.opacity(0.04), radius: 12, x: 0, y: 6)
    }
}

extension View {
    func card(padding: CGFloat = 18) -> some View { modifier(CardModifier(padding: padding)) }

    /// Grey app background behind scroll views and lists
    func screenBackground() -> some View {
        background(Theme.bg.ignoresSafeArea())
    }
}

struct SectionTitle: View {
    let title: String
    var trailing: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(.title3, design: .rounded).weight(.bold))
            Spacer()
            if let trailing = trailing {
                Text(trailing).font(.subheadline.weight(.semibold)).foregroundColor(Theme.text3)
            }
        }
    }
}

struct CategoryAvatar: View {
    let category: String
    var size: CGFloat = 42
    var body: some View {
        let c = CategoryStyle.color(category)
        Image(systemName: CategoryStyle.icon(category))
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundColor(c)
            .frame(width: size, height: size)
            .background(c.opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.36, style: .continuous))
    }
}

struct ProgressBar: View {
    /// 0...1 (clamped)
    let value: Double
    var color: Color = Theme.accent
    var track: Color = Theme.surface2
    var height: CGFloat = 8
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(color)
                    .frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
            }
        }
        .frame(height: height)
    }
}

struct SourceBadge: View {
    let source: String
    var body: some View {
        let (label, color): (String, Color) = {
            switch source {
            case "revolut_eur": return ("R€", Color(hex: "#2f7bff"))
            case "revolut_usd": return ("R$", Color(hex: "#14b5c9"))
            case "intesa", "intesa_eur": return ("IS", Color(hex: "#16a86c"))
            case "satispay": return ("SP", Theme.accent)
            default: return ("—", Theme.text3)
            }
        }()
        Text(label)
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .foregroundColor(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct WalletTag: View {
    let wallet: Wallet
    var body: some View {
        let c = Color.wallet(wallet.color)
        HStack(spacing: 4) {
            Circle().fill(c).frame(width: 6, height: 6)
            Text(wallet.name).lineLimit(1)
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(c)
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(c.opacity(0.12), in: Capsule())
    }
}

struct EmptyStateView: View {
    let icon: String
    let title: String
    var text: String? = nil
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(Theme.accent)
                .frame(width: 56, height: 56)
                .background(Theme.accentSoft, in: Circle())
            Text(title).font(.headline)
            if let text = text {
                Text(text).font(.subheadline).foregroundColor(Theme.text2).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundColor(.white)
            .padding(.vertical, 14).padding(.horizontal, 20)
            .frame(maxWidth: .infinity)
            .background(Theme.accent, in: Capsule())
            .shadow(color: Theme.accent.opacity(0.3), radius: 10, x: 0, y: 6)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct SoftButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundColor(Theme.accentInk)
            .padding(.vertical, 10).padding(.horizontal, 14)
            .background(Theme.accentSoft, in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Transaction rows

struct TransactionRowView: View {
    @EnvironmentObject var viewModel: FinancialViewModel
    let transaction: Transaction
    var isBalanceHidden: Bool = false
    var showsWallet: Bool = true

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CategoryAvatar(category: transaction.category)
            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.description)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(transaction.category).lineLimit(1)
                        .font(.caption).foregroundColor(Theme.text2)
                    SourceBadge(source: transaction.source)
                    if showsWallet, let w = viewModel.wallet(id: transaction.walletId) {
                        WalletTag(wallet: w)
                    }
                }
                if let details = transaction.details, !details.isEmpty {
                    Text(Fmt.shortDetails(details))
                        .font(.caption2).foregroundColor(Theme.text3).lineLimit(1)
                }
                if let note = transaction.notes, !note.trimmingCharacters(in: .whitespaces).isEmpty {
                    Label(note, systemImage: "note.text")
                        .font(.caption2).foregroundColor(Theme.warning).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(isBalanceHidden ? "•••" : Fmt.signed(transaction.amountEUR))
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundColor(transaction.isIncome ? Theme.success : Theme.text)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

struct DayGroup: Identifiable {
    var id: String { date }
    let date: String
    let txs: [Transaction]
    var total: Double { txs.reduce(0) { $0 + $1.amountEUR } }
}

/// Groups transactions already sorted by date (newest first) under one header per day
func groupByDay(_ txs: [Transaction]) -> [DayGroup] {
    var groups: [DayGroup] = []
    var current: [Transaction] = []
    for tx in txs {
        if let last = current.last, last.date != tx.date {
            groups.append(DayGroup(date: last.date, txs: current))
            current = []
        }
        current.append(tx)
    }
    if let last = current.last { groups.append(DayGroup(date: last.date, txs: current)) }
    return groups
}

struct DayHeader: View {
    let group: DayGroup
    var isBalanceHidden: Bool = false
    var body: some View {
        HStack {
            Text(Fmt.dayLabel(group.date).capitalizedFirst)
            Spacer()
            Text(isBalanceHidden ? "•••" : Fmt.signed(group.total))
        }
        .font(.footnote.weight(.semibold))
        .foregroundColor(Theme.text3)
        .textCase(nil)
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
