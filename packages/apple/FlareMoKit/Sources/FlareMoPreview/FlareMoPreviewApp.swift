import AppKit
import FlareMoDesign
import FlareMoUI
import SwiftUI

/// 开发用渲染器。
///
/// 两个用途：
///   `swift run flaremo-preview`            → 用假数据渲染 PNG 到 ./Temp/preview/
///   `swift run flaremo-preview --live`     → 用**真实本地库**渲染 PNG（看到的就是 App 里的样子）
///   `swift run flaremo-preview --window`   → 直接开一个窗口看真实交互
///
/// 为什么需要它：Xcode 工程还没建好时（以及快照测试要固定尺寸时），
/// 需要一个不依赖 Xcode、不依赖模拟器的看图手段。
///
/// 渲染走 `NSHostingView` 的真实布局 + 位图上下文，而不是 SwiftUI 的 `ImageRenderer`：
/// `ImageRenderer` 给 `GeometryReader` 的提议尺寸不可靠，会让依赖窗口宽度的布局
/// （我们这个框架就是）算出错误的列宽。NSHostingView 走的是 AppKit 真布局路径，
/// 截出来的图和 App 里看到的一致。

@main
struct FlareMoPreviewApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        if CommandLine.arguments.contains("--reading") {
            renderReadingSample()
            return
        }
        if CommandLine.arguments.contains("--detail") {
            let model = PreviewData.model
            if let first = PreviewData.memos.first { model.openDetail(memoID: first.id) }
            renderSnapshots(model: model, suffix: "detail")
            return
        }
        if CommandLine.arguments.contains("--live") {
            renderSnapshots(model: FMAppModel(), suffix: "live")
            return
        }
        if CommandLine.arguments.contains("--window") {
            openWindow()
            app.run()
        } else {
            renderSnapshots(model: PreviewData.model, suffix: "workspace")
        }
    }

    // MARK: 窗口模式

    @MainActor
    private static func openWindow() {
        let content = FMWorkspaceRoot(model: PreviewData.model)
            .frame(minWidth: 1200, minHeight: 780)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "FlareMo"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.contentView = NSHostingView(rootView: content)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: 阅读态样例

    /// 把所有块级形态与行内样式一次性渲染出来，改渲染时先看这张。
    @MainActor
    private static func renderReadingSample() {
        let size = CGSize(width: 720, height: 1400)
        let view = ScrollView {
            FMBlockView(markdown: FMReadingSample.markdown)
                .padding(24)
        }
        .background(FMColor.background.color)

        let outputDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("Temp/preview", isDirectory: true)
        try? FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        for (name, appearance) in [
            ("light", NSAppearance.Name.aqua),
            ("dark", NSAppearance.Name.darkAqua),
        ] {
            let url = outputDirectory.appendingPathComponent("reading-\(name).png")
            if snapshot(view, size: size, appearance: appearance, scale: 2, to: url) {
                print("✓ \(url.path)")
            }
        }
    }

    // MARK: 渲染模式

    @MainActor
    private static func renderSnapshots(model: FMAppModel, suffix: String) {
        let outputDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("Temp/preview", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )

        let size = CGSize(width: 1360, height: 860)
        let root = FMWorkspaceRoot(model: model)

        for (name, appearance) in [
            ("light", NSAppearance.Name.aqua),
            ("dark", NSAppearance.Name.darkAqua),
        ] {
            let url = outputDirectory.appendingPathComponent("\(suffix)-\(name).png")
            if snapshot(root, size: size, appearance: appearance, scale: 2, to: url) {
                print("✓ \(url.path)")
            } else {
                FileHandle.standardError.write("✗ 渲染 \(name) 失败\n".data(using: .utf8)!)
            }
        }
    }

    /// 用 NSHostingView 真实布局后截一张 PNG。
    @MainActor
    private static func snapshot(
        _ view: some View,
        size: CGSize,
        appearance: NSAppearance.Name,
        scale: CGFloat,
        to url: URL
    ) -> Bool {
        // 必须显式给尺寸：NSHostingView 会按内容的 ideal/min 尺寸布局，
        // 只设 frame 不够（FMWorkspaceRoot 有 minWidth 780，会按 780 排版）。
        let sized = view.frame(width: size.width, height: size.height)
        let hosting = NSHostingView(rootView: AnyView(sized))
        hosting.frame = CGRect(origin: .zero, size: size)
        hosting.appearance = NSAppearance(named: appearance)
        // 先把内容按目标尺寸摆好，再进位图上下文画一遍。
        hosting.layoutSubtreeIfNeeded()

        // 用 AppKit 的缓存显示路径：它自己处理 backing scale，
        // 不用手动算像素、也不用缩 CTM（手动缩放会和视图自带的 2x 叠加成 4x）。
        hosting.layer?.contentsScale = scale
        guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            return false
        }
        hosting.cacheDisplay(in: hosting.bounds, to: rep)

        guard let data = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? data.write(to: url)) != nil
    }
}
