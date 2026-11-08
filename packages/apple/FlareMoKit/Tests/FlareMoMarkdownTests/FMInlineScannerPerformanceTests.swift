//
//  FMInlineScannerPerformanceTests.swift
//  FlareMoMarkdownTests
//
//  职责：把「编辑器逐键调用不能卡」钉成断言。
//  指标口径：10KB 备忘录整段扫描一次 < 3ms（debug 构建，本机 M5 Pro 实测约 1.1ms；
//  release 构建快一个量级）。取多次运行里的最好成绩，避开测试机上偶然的调度抖动。
//
//  另外守一个「不能退化回 O(n²)」的底线：一批故意刁钻的输入（整行落单的开标记、
//  成百上千个未闭合反引号 / 方括号）必须在线性时间内扫完，否则用户只要输入一个
//  没闭合的 `**`，整篇文字就会越打越卡。
//

import Foundation
import Testing

@testable import FlareMoMarkdown

/// 10KB 的真实备忘录：中英文混排、列表、待办、引用、围栏、链接、标签、emoji 都有。
private let realisticMemoFragment = """
# 今天的工作记录

早上看了 **Swift 6.2** 的并发文档，重点是 `Actor` 的隔离模型与 `Sendable` 的传播，*这一段是斜体*，~~这段是删除~~。
顺手记下几个链接：[Swift 组织](https://github.com/apple/swift) 以及 [论坛](https://forums.swift.org)。

- 第一件事：把本地库 schema 和 D1 对齐
- 第二件事：处理 *同步* 冲突
- [ ] 晚上补上 FTS5 的中文搜索用例
- [x] 每周回顾

> 引用一段话：写文档的时候，先写清楚为什么，再写怎么做。

```swift
func ping(_ url: URL) async throws -> Bool {
    let (_, response) = try await URLSession.shared.data(from: url)
    return (response as? HTTPURLResponse)?.statusCode == 200
}
```

标签：#flutter #swift #笔记/读书 还有 ==高亮== 的句子。中文与 emoji 😀🚀 混排，偏移必须对。
1. 有序项目一
2. 有序项目二

"""

/// 拼一段刚好 ≥ 10,000 个 UTF-16 单元的文本。
private func makeTenKiloByteFixture() -> String {
    var text = realisticMemoFragment
    while text.utf16.count < 10_000 {
        text += "\n\n" + realisticMemoFragment
    }
    return String(text.prefix(10_000))
}

@Suite("性能")
struct FMInlineScannerPerformanceTests {
    @Test("10KB 文本单次扫描 < 3ms")
    func tenKiloBytesUnder3Milliseconds() {
        let source = makeTenKiloByteFixture()
        #expect(source.utf16.count >= 10_000)

        // 预热：第一次调用会带上数组转换、缓存填充等一次性成本。
        _ = FMInlineScanner.spans(in: source)

        let clock = ContinuousClock()
        var best = Duration.seconds(60)
        for _ in 0..<20 {
            let elapsed = clock.measure {
                _ = FMInlineScanner.spans(in: source)
            }
            if elapsed < best { best = elapsed }
        }
        let milliseconds = Double(best.components.attoseconds) / 1e15
        print("PERF 10KB scanner best = \(milliseconds) ms (utf16=\(source.utf16.count))")
        #expect(best < .milliseconds(3), "10KB 扫描耗时 \(best)，超过 3ms")

        // 顺带保证扫描真的在工作，而不是提前返回空数组把性能「优化」掉。
        #expect(FMInlineScanner.spans(in: source).count > 50)
    }

    @Test(
        "刁钻输入必须线性：不能因为一个没闭合的标记退化到 O(n²)",
        arguments: [
            String(repeating: "**未闭合 ", count: 700),
            String(repeating: "*未闭合 ", count: 900),
            String(repeating: "`未闭合 ", count: 900),
            String(repeating: "[未闭合 ", count: 900),
            String(repeating: "~~未闭合 ", count: 800),
            String(repeating: "==未闭合 ", count: 800),
            String(repeating: "#", count: 5_000),
            String(repeating: "_a", count: 3_000),
            String(repeating: "**[a](", count: 700),
            String(repeating: "[]( ", count: 1_000),
            String(repeating: "[a](b", count: 800),
        ]
    )
    func adversarialInputsStayFast(source: String) {
        let clock = ContinuousClock()
        var best = Duration.seconds(60)
        for _ in 0..<5 {
            let elapsed = clock.measure {
                _ = FMInlineScanner.spans(in: source)
            }
            if elapsed < best { best = elapsed }
        }
        let milliseconds = Double(best.components.attoseconds) / 1e15
        print("PERF adversarial len=\(source.utf16.count) best = \(milliseconds) ms")
        // debug 构建下这些输入都在 3ms 以内；给 50ms 的宽限只为抓 O(n²) 退化，不是性能指标。
        #expect(best < .milliseconds(50), "刁钻输入耗时 \(best)，疑似退化成平方复杂度")
    }

    @Test("同一份 10KB 文本重复扫描结果一致（无状态泄漏）")
    func stableResults() {
        let source = makeTenKiloByteFixture()
        let first = FMInlineScanner.spans(in: source)
        for _ in 0..<3 {
            #expect(FMInlineScanner.spans(in: source) == first)
        }
    }
}
