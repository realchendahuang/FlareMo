import Foundation
import GRDB

/// 本文件负责：时间戳类型 —— 与服务端 `Date.prototype.toISOString()` 逐字节一致的
/// ISO-8601 毫秒文本（`YYYY-MM-DDTHH:mm:ss.sssZ`）。
///
/// 为什么不用 `Date` / `DateFormatter`（见 docs/native-clients.md §7.7「三个全局约定」
/// 第 2 条与 §4.1）：
/// - D1 里 `created_at` / `updated_at` / `deleted_at` 都是 **text**，存的就是
///   `toISOString()` 的结果。text 的字典序 = 时间序，服务端索引
///   `memos_user_updated_id_idx (user_id, updated_at, id)` 直接依赖这一点。
/// - 本地若把时间转成 `Date` 再经 `DateFormatter` 往回写，会受 locale / 日历
///   / 时区影响，且可能出现 `.5` / `.500` 这类小数位不一致，破坏与服务端的
///   「逐字节一致」。这里用手写的公历换算，完全确定、不经过 ICU。
///
/// 有效格式固定 24 字符：`1970-01-01T00:00:00.000Z`。闰年、月日范围在解析时校验。
/// 年份限制在 0000...9999（与 `toISOString()` 的 4 位年份形式一致；超出范围的
/// 日期在此库里没有使用场景）。
public struct ISOTimestamp: Sendable, Hashable {
    /// 规范化后的文本形态，也是数据库里的存储形态。
    public let string: String

    // MARK: - 构造

    /// 当前时刻（毫秒精度）。
    public static func now() -> ISOTimestamp {
        ISOTimestamp(millisecondsSince1970: currentMilliseconds())
    }

    /// 从 `Date` 构造。向下取整到毫秒（`Date` 是浮点秒，毫秒以下无意义；
    /// 向下取整保证不会把时间标到「未来」，与服务端 `Date.now()` 的语义一致）。
    public init(date: Date) {
        self.init(millisecondsSince1970: Int64((date.timeIntervalSince1970 * 1000).rounded()))
    }

    public init(millisecondsSince1970: Int64) {
        self.init(unchecked: Self.format(millisecondsSince1970: millisecondsSince1970))
    }

    /// 从文本构造并校验格式；不符合 `toISOString()` 形态时返回 nil。
    public init?(validating string: String) {
        guard Self.parseMilliseconds(string) != nil else { return nil }
        self.init(unchecked: string)
    }

    /// 绕过校验的内部构造：只给本类型自己的格式化输出用。
    private init(unchecked string: String) {
        self.string = string
    }

    // MARK: - 读取

    public var millisecondsSince1970: Int64 {
        // 构造时已校验/格式化，parse 必定成功。
        Self.parseMilliseconds(string) ?? 0
    }

    public var date: Date {
        Date(timeIntervalSince1970: Double(millisecondsSince1970) / 1000)
    }

    /// 回到 UTC 的当天 0 点（`before:` / `after:` 操作符与 D1 的
    /// `toUtcDayStart` 语义一致）。
    public func utcDayStart() -> ISOTimestamp {
        let milliseconds = millisecondsSince1970
        var days = milliseconds / 86_400_000
        if milliseconds % 86_400_000 < 0 { days -= 1 }
        return ISOTimestamp(millisecondsSince1970: days * 86_400_000)
    }

    public func adding(seconds: TimeInterval) -> ISOTimestamp {
        ISOTimestamp(millisecondsSince1970: millisecondsSince1970 + Int64((seconds * 1000).rounded()))
    }

    // MARK: - 比较与展示

    public static func < (lhs: ISOTimestamp, rhs: ISOTimestamp) -> Bool {
        lhs.string < rhs.string
    }

    public var description: String { string }

    /// 服务端此刻的毫秒整数。
    static func currentMilliseconds() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }

    // MARK: - 格式化 / 解析（手写公历换算，确定性，不经过 ICU）

    /// UNIX 毫秒 → `YYYY-MM-DDTHH:mm:ss.sssZ`。
    static func format(millisecondsSince1970 milliseconds: Int64) -> String {
        var days = milliseconds / 86_400_000
        var millisecondsOfDay = milliseconds % 86_400_000
        if millisecondsOfDay < 0 {
            millisecondsOfDay += 86_400_000
            days -= 1
        }
        let civil = civilFromDays(days)
        let hour = millisecondsOfDay / 3_600_000
        let minute = millisecondsOfDay % 3_600_000 / 60_000
        let second = millisecondsOfDay % 60_000 / 1000
        let millisecond = millisecondsOfDay % 1000
        return String(
            format: "%04lld-%02lld-%02lldT%02lld:%02lld:%02lld.%03lldZ",
            civil.year, civil.month, civil.day,
            hour, minute, second, millisecond)
    }

    /// `YYYY-MM-DDTHH:mm:ss.sssZ` → UNIX 毫秒；格式/范围非法返回 nil。
    static func parseMilliseconds(_ string: String) -> Int64? {
        let characters = Array(string.utf8)
        guard characters.count == 24 else { return nil }
        // 固定的分隔符位置：`0123-56-89T12:45:78.012Z`（列号 0 起）。
        guard characters[4] == UInt8(ascii: "-"),
            characters[7] == UInt8(ascii: "-"),
            characters[10] == UInt8(ascii: "T"),
            characters[13] == UInt8(ascii: ":"),
            characters[16] == UInt8(ascii: ":"),
            characters[19] == UInt8(ascii: "."),
            characters[23] == UInt8(ascii: "Z")
        else { return nil }

        func digits(_ range: Range<Int>) -> Int64? {
            var value: Int64 = 0
            for index in range {
                let byte = characters[index]
                guard byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else { return nil }
                value = value * 10 + Int64(byte - UInt8(ascii: "0"))
            }
            return value
        }

        guard let year = digits(0..<4),
            let month = digits(5..<7),
            let day = digits(8..<10),
            let hour = digits(11..<13),
            let minute = digits(14..<16),
            let second = digits(17..<19),
            let millisecond = digits(20..<23)
        else { return nil }

        guard month >= 1, month <= 12,
            day >= 1, day <= daysInMonth(year: year, month: month),
            hour >= 0, hour <= 23,
            minute >= 0, minute <= 59,
            second >= 0, second <= 59
        else { return nil }

        let days = daysFromCivil(year: year, month: month, day: day)
        return days * 86_400_000
            + hour * 3_600_000
            + minute * 60_000
            + second * 1000
            + millisecond
    }

    private static func isLeapYear(_ year: Int64) -> Bool {
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    }

    private static func daysInMonth(year: Int64, month: Int64) -> Int64 {
        switch month {
        case 2: return isLeapYear(year) ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    /// Howard Hinnant 的 `days_from_civil`：公历 Y/M/D → 1970-01-01 起的天数。
    private static func daysFromCivil(year: Int64, month: Int64, day: Int64) -> Int64 {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let monthPrime = month > 2 ? month - 3 : month + 9
        let dayOfYear = (153 * monthPrime + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    /// `days_from_civil` 的逆运算：天数 → 公历 Y/M/D。
    private static func civilFromDays(_ days: Int64) -> (year: Int64, month: Int64, day: Int64) {
        let shifted = days + 719_468
        let era = (shifted >= 0 ? shifted : shifted - 146_096) / 146_097
        let dayOfEra = shifted - era * 146_097
        let yearOfEra =
            (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        let year = yearOfEra + era * 400
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthPrime = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthPrime + 2) / 5 + 1
        let month = monthPrime < 10 ? monthPrime + 3 : monthPrime - 9
        return (month <= 2 ? year + 1 : year, month, day)
    }
}

// MARK: - Codable / GRDB

extension ISOTimestamp: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let timestamp = ISOTimestamp(validating: string) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "不是 toISOString() 形态的 ISO-8601 毫秒文本: \(string)")
        }
        self = timestamp
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(string)
    }
}

extension ISOTimestamp: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { string.databaseValue }

    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> ISOTimestamp? {
        String.fromDatabaseValue(dbValue).flatMap(ISOTimestamp.init(validating:))
    }
}

extension ISOTimestamp: CustomStringConvertible {}

extension ISOTimestamp: ExpressibleByStringLiteral {
    /// 只给测试与固定常量用（如 `memo_relations.updated_at` 的 1970 默认值）；
    /// 非法字符串会在运行时 crash，生产代码请用 `init(validating:)`。
    public init(stringLiteral value: String) {
        guard let timestamp = ISOTimestamp(validating: value) else {
            preconditionFailure("非法的 ISO-8601 毫秒文本字面量: \(value)")
        }
        self = timestamp
    }
}
