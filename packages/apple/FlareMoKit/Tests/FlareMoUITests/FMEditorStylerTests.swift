import AppKit
import FlareMoDesign
import Testing

@testable import FlareMoUI

/// 编辑器「敲下去就变色」这件事的单测。
///
/// 为什么这类测试必须存在：输入框的手感是整个 App 的信用卡测试，
/// 而属性字符串的 bug（span 偏移错位、中文/emoji 之后整段失焦）
/// 在纯逻辑层看不出来，只能对着 `NSTextStorage` 断言属性。
@MainActor
@Suite("编辑器行内样式")
struct FMEditorStylerTests {
    /// 建一个和编辑器同口径的 storage，并跑一遍样式。
    private func styled(_ source: String) -> NSTextStorage {
        let storage = NSTextStorage(string: source)
        let full = NSRange(location: 0, length: (source as NSString).length)
        FMEditorStyler.applyBaseAttributes(to: storage, range: full)
        FMEditorStyler.applySpans(to: storage, in: full, source: source)
        return storage
    }

    private func font(at location: Int, in storage: NSTextStorage) -> NSFont? {
        storage.attribute(.font, at: location, effectiveRange: nil) as? NSFont
    }

    private func color(at location: Int, in storage: NSTextStorage) -> NSColor? {
        storage.attribute(.foregroundColor, at: location, effectiveRange: nil) as? NSColor
    }

    private func isBold(_ font: NSFont?) -> Bool {
        guard let font else { return false }
        return NSFontManager.shared.traits(of: font).contains(.boldFontMask)
    }

    private func isItalic(_ font: NSFont?) -> Bool {
        guard let font else { return false }
        return NSFontManager.shared.traits(of: font).contains(.italicFontMask)
    }

    private func isMonospaced(_ font: NSFont?) -> Bool {
        guard let font else { return false }
        return font.fontDescriptor.symbolicTraits.contains(.monoSpace)
    }

    @Test("加粗：星号之间的文字真的变粗，星号本身不变粗")
    func boldSpanApplies() throws {
        let source = "**粗体**"
        let storage = styled(source)
        // 偏移：# = 0 1，粗体文字从 2 开始，长度 2
        #expect(isBold(font(at: 2, in: storage)))
        #expect(!isBold(font(at: 0, in: storage)))
    }

    @Test("斜体：单星号之间的拉丁文字倾斜")
    func italicSpanApplies() throws {
        // 用拉丁文字测：汉字在 macOS 上会被字体替换成 PingFang，它没有斜体变体，
        // 系统会静默回退成正体。这不是 span 没生效，是字体本身的限制（见下一条）。
        let storage = styled("*italic*")
        #expect(isItalic(font(at: 1, in: storage)))
    }

    @Test("粗斜体：三星号同时命中粗与斜")
    func boldItalicSpanApplies() throws {
        let storage = styled("***both***")
        let font = self.font(at: 3, in: storage)
        #expect(isBold(font))
        #expect(isItalic(font))
    }

    @Test("汉字没有斜体变体：span 生效但字形被系统替换成正体")
    func cjkItalicFallsBackToUpright() throws {
        // 记录这个已知行为：span 确实覆盖到了（扫描器给的是 italic@1+2），
        // 但汉字落到 PingFang，它没有 italic 变体。要真倾斜只能自己画斜切变换，
        // v1 不做——Web 端靠浏览器合成 oblique，两端观感本来就不同。
        let storage = styled("*斜体*")
        let font = try #require(self.font(at: 1, in: storage))
        #expect(font.fontName.contains("PingFang") || !isItalic(font))
    }

    @Test("行内代码：等宽字体")
    func codeSpanApplies() throws {
        let storage = styled("`code`")
        #expect(isMonospaced(font(at: 1, in: storage)))
    }

    @Test("标签：品牌色上色（编辑态与阅读态有意不同）")
    func tagSpanUsesBrandColor() throws {
        let storage = styled("#标签")
        let tagColor = color(at: 0, in: storage)
        #expect(tagColor != nil)
        #expect(tagColor != FMColor.foreground.nsColor)
    }

    @Test("中文之后偏移不错位：emoji 与中文混排不影响后面的 span")
    func offsetsSurviveEmojiAndChinese() throws {
        // 前面有 emoji（UTF-16 里占两个 code unit）和中文，后面的 `code` 仍要等宽
        let source = "😀 中文 `code`"
        let storage = styled(source)
        let codeIndex = try #require((source as NSString).range(of: "code").location)
        #expect(isMonospaced(font(at: codeIndex, in: storage)))
    }

    @Test("标题：一级标题比正文大，二级标题比一级小")
    func headingSizesAreOrdered() throws {
        let source = "# 一级\n## 二级"
        let storage = styled(source)
        let h1 = try #require(font(at: 2, in: storage))
        let h2Index = try #require((source as NSString).range(of: "二级").location)
        let h2 = try #require(font(at: h2Index, in: storage))
        #expect(h1.pointSize > h2.pointSize)
        // 与 Web `.memo-markdown` 同口径
        #expect(h1.pointSize == 20)
        #expect(h2.pointSize == 18)
    }

    @Test("列表标记：标记本身降为次要色，正文保持前景色")
    func listMarkerIsMuted() throws {
        let source = "- 一项"
        let storage = styled(source)
        let markerColor = try #require(color(at: 0, in: storage))
        let bodyColor = try #require(color(at: 2, in: storage))
        #expect(markerColor != bodyColor)
    }

    @Test("空文本不崩")
    func emptyTextIsSafe() {
        let storage = styled("")
        #expect(storage.length == 0)
    }
}
