import FlareMoUI
import Foundation

/// 预览与快照用的假数据。
/// 接上本地库之后这个文件只服务于预览，不会进 App 的运行时路径。
@MainActor
enum PreviewData {
    /// 不打开数据库的预览模型（App 里用的是真库）。
    static let model = FMAppModel(
        previewMemos: memos,
        stats: stats,
        tags: tags
    )

    static let stats = FMSidebarStats(recordCount: 1284, tagCount: 37, streakDays: 12)

    static let tags = ["产品", "读书", "灵感", "会议", "旅行"]

    static let memos: [MemoPresentation] = [
        MemoPresentation(
            id: "01JB0000000000000000000001",
            content: """
            把「同步」这件事想清楚了一半：本地库才是事实源，网络只负责搬运变化。
            所以打开 App 的那一刻不该等任何请求——先读本地，同步在后台悄悄跑。
            """,
            createdAt: Date().addingTimeInterval(-60 * 12),
            tags: ["产品"],
            isPinned: true
        ),
        MemoPresentation(
            id: "01JB0000000000000000000002",
            content: """
            读到一句话：**克制不是少做，而是做的每一件都值得占位置。**
            flomo 的输入框只有一个，但它解决了 90% 的记录场景。
            """,
            createdAt: Date().addingTimeInterval(-60 * 95),
            tags: ["读书"]
        ),
        MemoPresentation(
            id: "01JB0000000000000000000003",
            content: """
            今天和团队过了一遍客户端的技术选型：
            1. Apple 侧 SwiftUI + GRDB，macOS 与 iOS 共享内核
            2. Kotlin 侧 Compose Multiplatform，Android 与 Windows 复用
            3. 接口契约只写一遍，两端都从 OpenAPI 生成
            """,
            createdAt: Date().addingTimeInterval(-60 * 60 * 5),
            tags: ["会议", "产品"]
        ),
        MemoPresentation(
            id: "01JB0000000000000000000004",
            content: """
            给 `sync_changes` 加了一个单调递增的 seq 游标之后，增量同步的复杂度直接塌掉了：
            客户端只需要记住一个整数，不用再猜哪个表漏了哪一行。
            """,
            createdAt: Date().addingTimeInterval(-60 * 60 * 26),
            tags: ["灵感"],
            commentCount: 2
        ),
        MemoPresentation(
            id: "01JB0000000000000000000005",
            content: "机场的咖啡比想象中好喝。这次出差唯一确定的收获是：以后尽量不坐早班机。",
            createdAt: Date().addingTimeInterval(-60 * 60 * 50),
            tags: ["旅行"],
            hasAttachment: true
        ),
        MemoPresentation(
            id: "01JB0000000000000000000006",
            content: """
            设计系统里最容易失控的不是颜色，是**间距**。
            一旦允许组件自己写 padding，三个月后就没有人知道 14 和 16 的区别了。
            """,
            createdAt: Date().addingTimeInterval(-60 * 60 * 74),
            tags: ["产品"]
        ),
    ]
}
