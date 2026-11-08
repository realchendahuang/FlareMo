import Testing
@testable import FlareMoMarkdown

@Suite("Markdown")
struct FlareMoMarkdownBasics {
    @Test("Markdown 版本非空")
    func versionIsSet() {
        #expect(!FlareMoMarkdown.version.isEmpty)
    }
}
