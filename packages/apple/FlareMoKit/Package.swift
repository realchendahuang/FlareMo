// swift-tools-version: 6.2
//
// FlareMoKit — FlareMo 的 Apple 端内核包（macOS 与 iOS 共用）。
//
// 结构（见 docs/native-clients.md §5.2）：
//   FlareMoCore     数据层 / API 客户端 / 同步引擎 / 模型，纯逻辑，不依赖 UI
//   FlareMoDesign   设计 token（脚本生成）+ 组件 + 字体
//   FlareMoMarkdown Markdown 解析与行内样式计算，纯逻辑
//
// 编辑器视图层（NSTextView / UITextView）不在这里，各平台各写一份。

import PackageDescription

let package = Package(
    name: "FlareMoKit",
    defaultLocalization: "zh-Hans",
    platforms: [
        // 部署目标见 §5.1：macOS 26 / iOS 26。内核包不含 26 以下会编译失败的新 API，
        // 将来要下沉到 iOS 18 只需改这一行 + UI 包。
        .macOS(.v26),
        .iOS(.v26),
    ],
    products: [
        .library(name: "FlareMoCore", targets: ["FlareMoCore"]),
        .library(name: "FlareMoDesign", targets: ["FlareMoDesign"]),
        .library(name: "FlareMoMarkdown", targets: ["FlareMoMarkdown"]),
        .library(name: "FlareMoUI", targets: ["FlareMoUI"]),
        .executable(name: "flaremo-preview", targets: ["FlareMoPreview"]),
        .executable(name: "FlareMoMac", targets: ["FlareMoMac"]),
        .executable(name: "flaremo-probe", targets: ["FlareMoProbe"]),
    ],
    dependencies: [
        // §5.3 依赖白名单。版本一律锁精确版本，不用 range：
        // 这些包都在 0.x / 快速迭代期，漂版本比落后的代价大。
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.12.0"),
        .package(url: "https://github.com/apple/swift-markdown.git", exact: "0.9.0"),
    ],
    targets: [
        .target(
            name: "FlareMoCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            swiftSettings: [
                .define("FLAREMO_CORE"),
            ]
        ),
        .target(
            name: "FlareMoDesign",
            swiftSettings: [
                // UI 包默认 MainActor 隔离，避免视图层到处写 @MainActor。
                .defaultIsolation(MainActor.self),
            ]
        ),
        .target(
            name: "FlareMoMarkdown",
            dependencies: [
                .product(name: "Markdown", package: "swift-markdown"),
            ]
        ),
        .testTarget(
            name: "FlareMoCoreTests",
            dependencies: ["FlareMoCore"],
            resources: [.copy("Fixtures")]
        ),
        .target(
            name: "FlareMoUI",
            dependencies: ["FlareMoDesign", "FlareMoCore", "FlareMoMarkdown"],
            swiftSettings: [
                .defaultIsolation(MainActor.self),
            ]
        ),
        // 开发用渲染器：把界面渲染成 PNG 或直接开一个窗口。
        // 它不进 App 包，只为「还没有 Xcode 工程时也能看界面」和快照测试兜底。
        .executableTarget(
            name: "FlareMoPreview",
            dependencies: ["FlareMoUI", "FlareMoDesign"],
            swiftSettings: [
                .defaultIsolation(MainActor.self),
            ]
        ),
        // 联调探针：设备配对 + 一轮真实同步，命令行跑，用来验证「客户端 ↔ 实例」这条链。
        .executableTarget(
            name: "FlareMoProbe",
            dependencies: ["FlareMoCore"],
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        // macOS App 本体：一层壳，界面全在 FlareMoUI。
        .executableTarget(
            name: "FlareMoMac",
            dependencies: ["FlareMoUI", "FlareMoDesign"],
            swiftSettings: [
                .defaultIsolation(MainActor.self),
            ]
        ),
        .testTarget(
            name: "FlareMoUITests",
            dependencies: ["FlareMoUI"]
        ),
        .testTarget(
            name: "FlareMoDesignTests",
            dependencies: ["FlareMoDesign"]
        ),
        .testTarget(
            name: "FlareMoMarkdownTests",
            dependencies: ["FlareMoMarkdown"]
        ),
    ]
)
