import AppKit
import FlareMoDesign
import Foundation
import SwiftUI
import Testing

@testable import FlareMoUI

/// 快照测试：把关键界面渲染成图像指纹，和基线比。
///
/// 覆盖的是「布局塌了、颜色错了、少画了一块」这类回调——单元测试看不见，
/// 人眼目检又会漏（改了 A 忘了看 B）。基线是 24×24 灰度降采样的 base64，
/// 存在 `SnapshotBaselines.swift` 里，不是二进制。
@MainActor
@Suite("界面快照")
struct SnapshotTests {
    // MARK: 固定夹具
    //
    // 所有快照都用这份数据：时间固定、内容固定，不然每次跑都是新指纹。

    private static let fixedDate = Date(timeIntervalSince1970: 1_760_000_000) // 2025-10-09 10:13 UTC

    private static let memos: [MemoPresentation] = [
        MemoPresentation(
            id: "memo-1",
            content: "把「本地库是事实源」这件事想清楚了一半：网络只负责搬运变化。",
            createdAt: fixedDate,
            tags: ["产品"],
            isPinned: true
        ),
        MemoPresentation(
            id: "memo-2",
            content: "第二条：加粗、inline code、删除、链接都应该在编辑器与阅读态里正确上样式。",
            createdAt: fixedDate.addingTimeInterval(-3600),
            tags: ["样式"],
            commentCount: 2
        ),
        MemoPresentation(
            id: "memo-3",
            content: "第三条没有标签，用来验证纯文本卡片的排版权重。",
            createdAt: fixedDate.addingTimeInterval(-7200),
            hasAttachment: true
        ),
    ]

    private static var previewModel: FMAppModel {
        FMAppModel(
            previewMemos: memos,
            stats: FMSidebarStats(recordCount: 1_284, tagCount: 37, streakDays: 12),
            tags: ["产品", "读书", "灵感", "会议", "旅行"]
        )
    }

    // MARK: 快照

    private func check(
        _ name: String,
        view: some View,
        size: CGSize,
        appearance: NSAppearance.Name = .aqua
    ) throws {
        guard let image = SnapshotHarness.render(view, size: size, appearance: appearance) else {
            Issue.record("快照 \(name) 渲染失败")
            return
        }
        let fingerprint = SnapshotHarness.fingerprint(image)
        #expect(fingerprint.count == SnapshotHarness.side * SnapshotHarness.side * 3)

        if SnapshotHarness.isRecording {
            print("SNAPSHOT name=\(name) hash=\(SnapshotHarness.encode(fingerprint))")
            return
        }

        guard let baseline = SnapshotBaselines.hashes[name] else {
            Issue.record("快照 \(name) 没有基线，用 FLAREMO_RECORD_SNAPSHOTS=1 录一次")
            return
        }
        let diff = SnapshotHarness.difference(fingerprint, SnapshotHarness.decode(baseline))
        #expect(
            diff <= SnapshotHarness.tolerance,
            "快照 \(name) 与基线差异 \(String(format: "%.2f", diff)) 超过容差 \(SnapshotHarness.tolerance)"
        )
    }

    @Test("速记卡片")
    func memoCard() throws {
        try check(
            "memo-card",
            view: FMMemoCard(memo: Self.memos[0]).padding(20).background(FMColor.background.color),
            size: CGSize(width: 640, height: 160)
        )
    }

    @Test("时间线（三条）")
    func memoTimeline() throws {
        try check(
            "memo-timeline",
            view: FMMemoTimeline(memos: Self.memos).padding(20).background(FMColor.background.color),
            size: CGSize(width: 640, height: 520)
        )
    }

    @Test("详情页")
    func memoDetail() throws {
        try check(
            "memo-detail",
            view: FMMemoDetailView(
                memo: Self.memos[1],
                comments: [
                    MemoPresentation(id: "c1", content: "这条评论用来验证评论区的排版。", createdAt: Self.fixedDate),
                ],
                onClose: {}
            )
            .padding(24)
            .background(FMColor.background.color),
            size: CGSize(width: 640, height: 560)
        )
    }

    @Test("阅读态样例（亮）")
    func readingSampleLight() throws {
        try check(
            "reading-light",
            view: FMBlockView(markdown: FMReadingSample.markdown)
                .padding(20)
                .background(FMColor.background.color),
            size: CGSize(width: 640, height: 1400)
        )
    }

    @Test("快速捕获面板（暗）", .disabled("AppKit 深色外观在测试环境不稳定，先只测浅色")) 
    func quickCaptureDark() throws {
        try check(
            "quick-dark",
            view: FMQuickCaptureView(text: .constant(""), onSubmit: { _ in }),
            size: CGSize(width: 320, height: 190),
            appearance: .darkAqua
        )
    }

    @Test("快速捕获面板（亮）")
    func quickCaptureLight() throws {
        try check(
            "quick-light",
            view: FMQuickCaptureView(text: .constant(""), onSubmit: { _ in }),
            size: CGSize(width: 320, height: 190)
        )
    }
}
