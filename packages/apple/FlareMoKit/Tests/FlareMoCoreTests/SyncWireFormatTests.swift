import Foundation
import Testing

@testable import FlareMoCore

/// 本文件负责：锁死同步接口的**线格式**。
///
/// 下面的 JSON 是后端实现真实吐出来的响应（不是手编的示意），
/// 字段名或嵌套一改，这里立刻红——这样客户端和后端不会悄悄漂。
@Suite("同步线格式")
struct SyncWireFormatTests {

    @Test("changes：snake_case + next_seq/has_more + entity_id")
    func decodesChanges() throws {
        let json = """
            {"changes":[
              {"seq":1,"entity":"memo","entity_id":"memos/375d","op":"upsert","version":1,"updated_at":"2026-11-08T17:43:14.284Z"},
              {"seq":2,"entity":"attachment","entity_id":"attachments/b70d","op":"upsert","version":1,"updated_at":"2026-11-08T17:43:14.316Z"}
            ],"next_seq":2,"has_more":true}
            """
        let page = try URLSessionSyncTransport.decoder.decode(
            SyncChangesPage.self,
            from: Data(json.utf8)
        )
        #expect(page.changes.count == 2)
        #expect(page.changes[0].entityId == "memos/375d")
        #expect(page.changes[0].entity == "memo")
        #expect(page.changes[0].op == "upsert")
        #expect(page.nextSeq == 2)
        #expect(page.hasMore)
    }

    @Test("hydrate：四类正文（含 relation 与 attachment 的 size/filename）")
    func decodesHydrate() throws {
        let json = """
            {
              "memos":[{"id":"memos/375d","user_id":"local-user","team_id":null,"content":"离线写的第一条 #sync",
                        "visibility":"private","status":"normal","pinned":false,"source":"web","client_id":"c1",
                        "payload":{},"created_at":"2026-11-08T17:43:14.284Z","updated_at":"2026-11-08T17:43:14.284Z",
                        "deleted_at":null,"version":1}],
              "attachments":[{"id":"attachments/afb5","user_id":"local-user","memo_id":"memos/375d",
                              "article_id":null,"r2_key":"uploads/demo.txt","filename":"demo.txt",
                              "content_type":"text/plain","size":7,"thumbnail_size":null,"state":"ready",
                              "client_id":"c2","etag":null,
                              "created_at":"2026-11-08T17:43:14.316Z","updated_at":"2026-11-08T17:43:14.316Z",
                              "deleted_at":null,"version":1}],
              "articles":[],
              "relations":[{"id":"memos/5f00","memo_id":"memos/5f00","related_memo_id":"memos/375d",
                            "type":"comment","created_at":"2026-11-08T17:43:14.500Z",
                            "updated_at":"2026-11-08T17:43:14.500Z","version":0}]
            }
            """
        let response = try URLSessionSyncTransport.decoder.decode(
            HydrateResponse.self,
            from: Data(json.utf8)
        )
        #expect(response.memos.first?.content == "离线写的第一条 #sync")
        #expect(response.attachments.first?.size == 7)
        #expect(response.attachments.first?.contentType == "text/plain")
        #expect(response.attachments.first?.filename == "demo.txt")
        #expect(response.attachments.first?.r2Key == "uploads/demo.txt")
        // 服务端没有 sha256 列：这个字段必须是可选的，否则整条 decode 会炸
        #expect(response.attachments.first?.clientId == "c2")
        #expect(response.relations.first?.type == "comment")
        #expect(response.relations.first?.relatedMemoId == "memos/375d")
    }

    @Test("instance：capabilities 是带版本号的对象，不是字符串数组")
    func decodesCapabilities() throws {
        let json = """
            {"version":"0.31.1","api_versions":["app-v1"],"capabilities":{
              "sync_changes":1,"sync_hydrate":1,"soft_delete_tombstone":1,
              "optimistic_lock":0,"native_push":[],"direct_upload":0,"pat_grant":0}}
            """
        let instance = try URLSessionSyncTransport.decoder.decode(
            InstanceCapabilities.self,
            from: Data(json.utf8)
        )
        #expect(instance.version == "0.31.1")
        #expect(instance.supports("sync_changes"))
        #expect(instance.version(of: "sync_changes") == 1)
        // 服务端明确说还没做：客户端必须降级，不能以为会收到 409
        #expect(instance.version(of: "optimistic_lock") == 0)
        #expect(instance.supports("native_push"))
    }

    @Test("hydrate 请求编码成 snake_case")
    func encodesHydrateRequest() throws {
        let request = HydrateRequest(
            memoIds: ["m1"],
            attachmentIds: ["a1"],
            articleIds: [],
            relationIds: ["r1"]
        )
        let data = try URLSessionSyncTransport.encoder.encode(request)
        let object = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        #expect(object["memo_ids"] as? [String] == ["m1"])
        #expect(object["relation_ids"] as? [String] == ["r1"])
        #expect(object["article_ids"] as? [String] == [])
    }
}
