import Testing
import Markdown
@testable import FlareMoMarkdown

@Suite("tempprobe")
struct TempProbe {
    @Test("ranges")
    func ranges() {
        let source = "第一段\n\n\n第二段\n\n- 一\n- 二\n\n\n```swift\ncode\n```"
        let document = Document(parsing: source)
        for child in document.children {
            print("PROBE \(type(of: child)) range=\(String(describing: child.range)) lineCount=\(String(describing: child.range.map { $0.lowerBound.line ..< $0.upperBound.line }))")
        }
        let ordered = Document(parsing: "3. 三\n4. 四")
        for child in ordered.children {
            if let list = child as? OrderedList {
                print("PROBE ordered start=\(list.startIndex)")
            }
        }
    }
}
