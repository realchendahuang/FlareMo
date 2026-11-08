import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：时间戳类型 `ISOTimestamp` 的单测 —— 与服务端
/// `Date.prototype.toISOString()` 逐字节一致、解析校验、比较与排序。
///
/// 参考值由 Node 生成（`node -e 'new Date(v).toISOString()'`），确保「逐字节一致」
/// 不是自己跟自己对拍：
///
/// ```
/// 0           => 1970-01-01T00:00:00.000Z
/// 1           => 1970-01-01T00:00:00.001Z
/// 120         => 1970-01-01T00:00:00.120Z
/// 5           => 1970-01-01T00:00:00.005Z
/// -1          => 1969-12-31T23:59:59.999Z
/// 1794149131123 => 2026-11-08T14:45:31.123Z
/// Date.UTC(2000,1,29,23,59,59,999) => 2000-02-29T23:59:59.999Z
/// Date.UTC(1900,0,1)               => 1900-01-01T00:00:00.000Z
/// ```
@Suite("ISOTimestamp")
struct ISOTimestampTests {
    @Test("格式化结果与 JS toISOString() 逐字节一致")
    func matchesJavaScript() {
        let cases: [(Int64, String)] = [
            (0, "1970-01-01T00:00:00.000Z"),
            (1, "1970-01-01T00:00:00.001Z"),
            (5, "1970-01-01T00:00:00.005Z"),
            (120, "1970-01-01T00:00:00.120Z"),
            (999, "1970-01-01T00:00:00.999Z"),
            (-1, "1969-12-31T23:59:59.999Z"),
            (-1000, "1969-12-31T23:59:59.000Z"),
            (1_794_149_131_123, "2026-11-08T14:45:31.123Z"),
            (1_794_149_131_007, "2026-11-08T14:45:31.007Z"),
            (951_868_799_999, "2000-02-29T23:59:59.999Z"),
            (-2_208_988_800_000, "1900-01-01T00:00:00.000Z"),
        ]
        for (milliseconds, expected) in cases {
            #expect(ISOTimestamp(millisecondsSince1970: milliseconds).string == expected)
            // 反解析同样要精确回到毫秒。
            #expect(ISOTimestamp(validating: expected)?.millisecondsSince1970 == milliseconds)
        }
    }

    @Test("Date → 文本：毫秒补齐 3 位")
    func formatsDateWithThreeFractionDigits() {
        let date = Date(timeIntervalSince1970: 1_794_149_131.123)
        #expect(ISOTimestamp(date: date).string == "2026-11-08T14:45:31.123Z")
        // .120 必须写满三位（JS 的 toISOString 行为），不能是 .12。
        #expect(ISOTimestamp(date: Date(timeIntervalSince1970: 0.12)).string == "1970-01-01T00:00:00.120Z")
        #expect(ISOTimestamp(date: Date(timeIntervalSince1970: 0.005)).string == "1970-01-01T00:00:00.005Z")
    }

    @Test("往返一致：文本 → Date → 文本")
    func roundTripsThroughDate() {
        let original = ISOTimestamp(millisecondsSince1970: 1_794_149_131_123)
        #expect(ISOTimestamp(date: original.date) == original)
        #expect(original.date.timeIntervalSince1970 == 1_794_149_131.123)
    }

    @Test("字符串序 = 时间序（D1 索引与 (updated_at, id) 兜底的前提）")
    func lexicographicOrderEqualsTimeOrder() {
        let timestamps = [
            "1969-12-31T23:59:59.999Z",
            "1970-01-01T00:00:00.000Z",
            "2025-11-08T03:45:31.123Z",
            "2026-11-08T14:45:31.006Z",
            "2026-11-08T14:45:31.123Z",
            "2026-11-09T00:00:00.000Z",
        ].map { TestTime.timestamp($0) }

        for (previous, next) in zip(timestamps, timestamps.dropFirst()) {
            #expect(previous < next)
            #expect(previous.string < next.string)
        }
    }

    @Test("非法文本一律拒绝", arguments: [
        "",
        "2026-11-08",
        "2026-11-08T14:45:31Z",
        "2026-11-08T14:45:31.12Z",
        "2026-11-08T14:45:31.123",
        "2026-13-01T00:00:00.000Z",
        "2026-00-10T00:00:00.000Z",
        "2026-02-30T00:00:00.000Z",
        "2025-02-29T00:00:00.000Z",
        "2026-11-08T24:00:00.000Z",
        "2026-11-08T14:60:00.000Z",
        "2026-11-08T14:45:60.000Z",
        "2026-11-08 14:45:31.123Z",
        "abcdefghijklmnopqrstuvwx",
    ])
    func rejectsInvalidStrings(value: String) {
        #expect(ISOTimestamp(validating: value) == nil)
    }

    @Test("闰年 2 月 29 日可用，否则拒绝")
    func leapYearHandling() {
        #expect(ISOTimestamp(validating: "2024-02-29T00:00:00.000Z") != nil)
        #expect(ISOTimestamp(validating: "2025-02-29T00:00:00.000Z") == nil)
        #expect(ISOTimestamp(validating: "2000-02-29T00:00:00.000Z") != nil)
        #expect(ISOTimestamp(validating: "1900-02-29T00:00:00.000Z") == nil)
    }

    @Test("UTC 当天 0 点（before/after 操作符用）")
    func utcDayStart() {
        #expect(TestTime.timestamp("2026-11-08T14:45:31.123Z").utcDayStart().string
            == "2026-11-08T00:00:00.000Z")
        #expect(TestTime.timestamp("1970-01-01T00:00:00.001Z").utcDayStart().string
            == "1970-01-01T00:00:00.000Z")
    }

    @Test("数据库值往返")
    func databaseValueRoundTrip() throws {
        let timestamp = ISOTimestamp(millisecondsSince1970: 1_794_149_131_123)
        #expect(ISOTimestamp.fromDatabaseValue(timestamp.databaseValue) == timestamp)
        #expect(ISOTimestamp.fromDatabaseValue("not-a-timestamp".databaseValue) == nil)
    }

    @Test("JSON 往返：单个字符串，不变成对象/数字")
    func codableAsSingleString() throws {
        let timestamp = ISOTimestamp(millisecondsSince1970: 1_794_149_131_007)
        let data = try JSONEncoder().encode(["at": timestamp])
        let json = String(decoding: data, as: UTF8.self)
        #expect(json == #"{"at":"2026-11-08T14:45:31.007Z"}"#)
        let decoded = try JSONDecoder().decode([String: ISOTimestamp].self, from: data)
        #expect(decoded["at"] == timestamp)
    }
}
