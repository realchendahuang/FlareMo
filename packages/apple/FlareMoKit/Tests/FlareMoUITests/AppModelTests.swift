import FlareMoCore
import Foundation
import Testing

@testable import FlareMoUI

/// 端到端验证「界面 → 本地库」这条链：模型写的就是 SQLite，UI 读的就是它。
/// 这层测试替代不了目检，但能守住"接了库之后其实没写进去"这类低级事故。
@MainActor
@Suite("AppModel ↔ 本地库")
struct AppModelTests {
    /// 每个用例一个临时目录，互不干扰。
    private func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("flaremo-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("新建速记会落进本地库，并且立刻出现在列表里")
    func createPersists() throws {
        let directory = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let model = FMAppModel(databaseDirectory: directory)
        #expect(model.openFailure == nil, "本地库应当能打开：\(model.openFailure ?? "")")

        #expect(model.createMemo(content: "第一条速记"))
        // 写入后模型会异步刷新（ValueObservation → 主线程），这里给它一次机会。
        model.refresh()

        #expect(model.memos.count == 1)
        #expect(model.memos.first?.content == "第一条速记")
        #expect(model.stats.recordCount == 1)
    }

    @Test("空内容不写库")
    func rejectsEmptyContent() throws {
        let directory = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let model = FMAppModel(databaseDirectory: directory)
        #expect(model.createMemo(content: "   \n  ") == false)
        model.refresh()
        #expect(model.memos.isEmpty)
    }

    @Test("重开模型能读回上一次写的数据（真的落盘了）")
    func roundTripsAcrossLaunches() throws {
        let directory = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        do {
            let model = FMAppModel(databaseDirectory: directory)
            #expect(model.createMemo(content: "跨重启还在"))
            model.refresh()
            #expect(model.memos.count == 1)
        }

        let reopened = FMAppModel(databaseDirectory: directory)
        reopened.refresh()
        #expect(reopened.memos.count == 1)
        #expect(reopened.memos.first?.content == "跨重启还在")
    }

    @Test("置顶与软删走同一条写路径")
    func pinAndDelete() throws {
        let directory = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let model = FMAppModel(databaseDirectory: directory)
        #expect(model.createMemo(content: "会被操作的一条"))
        model.refresh()
        let memoID = try #require(model.memos.first?.id)

        model.setPinned(memoID, pinned: true)
        model.refresh()
        #expect(model.memos.first?.isPinned == true)

        model.deleteMemo(memoID)
        model.refresh()
        #expect(model.memos.isEmpty, "软删之后时间线里不该再有它")
    }
}
