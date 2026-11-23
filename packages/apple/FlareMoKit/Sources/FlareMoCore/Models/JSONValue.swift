import Foundation

/// 本文件负责：本地库里的「自由 JSON」值 —— `JSONValue`。
///
/// 为什么需要它：D1 的 `memos.payload` 是 `text({ mode: "json" })` 且类型带
/// index signature（`MemoPayload` 允许任意未声明键，见
/// `packages/db/src/schema/rows.ts`）；`attachments.payload` 是
/// `Record<string, unknown>`。本地库是**副本**，同步进来的 payload 必须能原样
/// 存回去，不能因为 Swift 侧只认识几个已知字段就把未知键吃掉——那会让「本地
/// 库 = 服务端镜像」不成立，且同步往返会丢服务端数据。
///
/// 因此：已知字段用强类型（`MemoPayload`），未知字段统一装进 `JSONValue`，
/// 编码时原样摊回同一个 JSON 对象。
///
/// 数字保真：先尝试 `Int`，再 `Double`，避免把 `3` 存成 `3.0`；超过 2^53 的
/// 整数在 JSON 里本来就无法精确表示，payload 不会出现这种值。
///
/// ⚠️ 不要把 `JSONValue` 直接当数据库列类型：GRDB 解码 Codable 属性时会先试
/// 「单值列」（`init(from:)` 第一句就取 singleValueContainer），SQLite 会把
/// JSON 文本强转成 `0`。列里请用 `[String: JSONValue]`（Dictionary 的 Codable
/// 先请求 keyed container，会正确回落到 JSON 解码）或先请求 keyed container 的
/// 结构体（如 `MemoPayload`）。
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Bool.self) {
            // 注意顺序：`1` / `0` 必须落在 Int 分支，不能被 Bool 桥接吃掉。
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "不支持的 JSON 值")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

extension JSONValue {
    /// 把任意 `Encodable` 转成 `JSONValue`（outbox payload 里嵌实体字段用）。
    static func encoding<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral,
    ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
    ExpressibleByStringLiteral, ExpressibleByArrayLiteral,
    ExpressibleByDictionaryLiteral
{
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .int(value) }
    public init(floatLiteral value: Double) { self = .double(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(uniqueKeysWithValues: elements))
    }
}
