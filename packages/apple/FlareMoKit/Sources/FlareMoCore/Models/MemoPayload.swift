import Foundation

/// 本文件负责：`memos.payload` 列的类型化模型。
///
/// 对应 D1：`packages/db/src/schema/rows.ts` 的 `MemoPayload`
/// 与 `packages/contracts/src/memos.ts` 的 `memoPayloadSchema`：
///
/// ```ts
/// type MemoPayload = {
///   tags?: string[]
///   property?: { title?, has_link?, has_task_list?, has_code?, has_incomplete_tasks? }
///   location?: unknown
///   client_id?: string
///   [key: string]: unknown
/// }
/// ```
///
/// 设计取舍：已知字段强类型化，未声明键原样保存在 `extras` 里，编解码时摊平回
/// 同一个 JSON 对象 —— 本地库是服务端副本，任何「读进来再写回去」都不能丢字段。
public struct MemoPayload: Sendable, Hashable {
    /// D1 用 `json_each(payload.tags)` 派生 memo_tags；本地触发层不重建 tags，
    /// 但 payload 必须原样保存。
    public var tags: [String]?
    public var property: MemoProperty?
    /// 服务端 schema 里是 `z.unknown()`，这里保留原始 JSON。
    public var location: JSONValue?
    /// 离线创建的幂等键（与本地 memo id 相同）。
    public var clientID: String?
    /// 服务端未来新增、客户端还不认识的键。
    public var extras: [String: JSONValue]

    public init(
        tags: [String]? = nil,
        property: MemoProperty? = nil,
        location: JSONValue? = nil,
        clientID: String? = nil,
        extras: [String: JSONValue] = [:]
    ) {
        self.tags = tags
        self.property = property
        self.location = location
        self.clientID = clientID
        self.extras = extras
    }

    /// D1 的列默认值是 `{}`。
    public static let empty = MemoPayload()

    public var isEmpty: Bool {
        tags == nil && property == nil && location == nil && clientID == nil && extras.isEmpty
    }

    /// 按 Dart/Swift 命名惯例取「服务端 JSON 的 client_id」。
    public var clientId: String? { clientID }

    private static let reservedKeys: Set<String> = ["tags", "property", "location", "client_id"]
}

extension MemoPayload: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        var payload = MemoPayload()
        payload.tags = try container.decodeIfPresent([String].self, forKey: DynamicCodingKey("tags"))
        payload.property = try container.decodeIfPresent(
            MemoProperty.self, forKey: DynamicCodingKey("property"))
        payload.location = try container.decodeIfPresent(
            JSONValue.self, forKey: DynamicCodingKey("location"))
        payload.clientID = try container.decodeIfPresent(
            String.self, forKey: DynamicCodingKey("client_id"))
        var extras: [String: JSONValue] = [:]
        for key in container.allKeys where !Self.reservedKeys.contains(key.stringValue) {
            extras[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        payload.extras = extras
        self = payload
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        if let tags { try container.encode(tags, forKey: DynamicCodingKey("tags")) }
        if let property { try container.encode(property, forKey: DynamicCodingKey("property")) }
        if let location { try container.encode(location, forKey: DynamicCodingKey("location")) }
        if let clientID { try container.encode(clientID, forKey: DynamicCodingKey("client_id")) }
        for (key, value) in extras {
            try container.encode(value, forKey: DynamicCodingKey(key))
        }
    }
}

/// `memos.payload.property` 的已知字段（服务端 JSON 用 snake_case）。
public struct MemoProperty: Sendable, Hashable, Codable {
    public var title: String?
    public var hasLink: Bool?
    public var hasTaskList: Bool?
    public var hasCode: Bool?
    public var hasIncompleteTasks: Bool?

    public init(
        title: String? = nil,
        hasLink: Bool? = nil,
        hasTaskList: Bool? = nil,
        hasCode: Bool? = nil,
        hasIncompleteTasks: Bool? = nil
    ) {
        self.title = title
        self.hasLink = hasLink
        self.hasTaskList = hasTaskList
        self.hasCode = hasCode
        self.hasIncompleteTasks = hasIncompleteTasks
    }

    enum CodingKeys: String, CodingKey {
        case title
        case hasLink = "has_link"
        case hasTaskList = "has_task_list"
        case hasCode = "has_code"
        case hasIncompleteTasks = "has_incomplete_tasks"
    }
}

/// 动态 CodingKey：让 `MemoPayload` 的「已知字段 + 未知字段」能读写同一个 JSON
/// 对象（JSON 字段名不像数据库列名那样适合用静态 CodingKeys 穷举）。
struct DynamicCodingKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int? { nil }

    init(_ string: String) { self.stringValue = string }

    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}
