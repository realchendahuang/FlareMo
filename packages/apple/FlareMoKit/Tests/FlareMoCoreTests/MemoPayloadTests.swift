import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：`MemoPayload` / `JSONValue` 的单测 —— 已知字段强类型、未知字段
/// 不丢（本地库是服务端副本，payload 往返必须保真）。
@Suite("MemoPayload")
struct MemoPayloadTests {
    @Test("解码服务端形态：已知字段 + 未知字段都保留")
    func decodesKnownAndUnknownKeys() throws {
        let json = """
            {
              "tags": ["工作", "项目A"],
              "property": {"title": "标题", "has_link": true, "has_task_list": false},
              "client_id": "019b1f2a-aaaa-7bbb-8ccc-000000000001",
              "location": {"latitude": 31.2, "longitude": 121.5},
              "durationSeconds": 12.5,
              "audioAttachmentId": "att-1",
              "nested": {"a": [1, 2, {"b": null}]}
            }
            """
        let payload = try JSONDecoder().decode(MemoPayload.self, from: Data(json.utf8))

        #expect(payload.tags == ["工作", "项目A"])
        #expect(payload.property?.title == "标题")
        #expect(payload.property?.hasLink == true)
        #expect(payload.property?.hasTaskList == false)
        #expect(payload.clientID == "019b1f2a-aaaa-7bbb-8ccc-000000000001")
        #expect(payload.location == .object(["latitude": .double(31.2), "longitude": .double(121.5)]))
        #expect(payload.extras["durationSeconds"] == .double(12.5))
        #expect(payload.extras["audioAttachmentId"] == .string("att-1"))
        #expect(payload.extras["nested"] == .object(["a": .array([.int(1), .int(2), .object(["b": .null])])]))
    }

    @Test("编码后未知字段仍在，往返等价")
    func roundTripsWithoutLosingKeys() throws {
        let json = """
            {"tags":["a"],"property":{"has_code":true},"client_id":"c1","foo":"bar","count":3}
            """
        let payload = try JSONDecoder().decode(MemoPayload.self, from: Data(json.utf8))
        let data = try JSONEncoder().encode(payload)
        let reparsed = try JSONDecoder().decode(MemoPayload.self, from: data)
        #expect(reparsed == payload)
        #expect(reparsed.extras["foo"] == .string("bar"))
        #expect(reparsed.extras["count"] == .int(3))
    }

    @Test("空 payload 编码为 {}（对齐 D1 默认值）")
    func emptyEncodesAsEmptyObject() throws {
        let data = try JSONEncoder().encode(MemoPayload.empty)
        #expect(String(decoding: data, as: UTF8.self) == "{}")
        #expect(MemoPayload.empty.isEmpty)
    }

    @Test("数字保真：整数不变成浮点")
    func keepsIntegerNumbers() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data("3".utf8))
        #expect(value == .int(3))
        let encoded = try JSONEncoder().encode(JSONValue.int(3))
        #expect(String(decoding: encoded, as: UTF8.self) == "3")
    }

    @Test("JSONValue 编解码：布尔/字符串/数组/对象/空值")
    func jsonValueRoundTrip() throws {
        let value: JSONValue = .object([
            "b": .bool(true),
            "s": .string("中文"),
            "a": .array([.null, .int(1), .double(1.5)]),
        ])
        let data = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect(decoded == value)
    }
}
