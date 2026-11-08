import Foundation
import Testing

@testable import FlareMoDesign

/// `Generated/Localized.swift` 的契约测试。
///
/// 这里断言的是「行为」而不是具体译文：译文随时会随 Web 文案改动，测试不该跟着改。
/// 但语言解析、插值代入、Swift 保留字命名这几条是生成器的契约，坏了一定是 bug。
@MainActor
@Suite("本地化文案", .serialized)
struct I18nTests {
    /// 语言是进程级状态，测完必须还原，避免影响同一进程里的其它用例。
    private func withLanguage(_ language: L10n.SupportedLanguage, _ body: () throws -> Void) rethrows {
        let previous = L10n.language
        L10n.language = language
        defer { L10n.language = previous }
        try body()
    }

    @Test("v1 只支持 zh-Hans 与 en-US")
    func supportedLanguageList() {
        #expect(L10n.SupportedLanguage.allCases == [.zhHans, .enUS])
    }

    @Test("系统语言解析：简体中文走 zh-Hans，其余回落 en-US")
    func resolvesSystemLanguage() {
        #expect(L10n.SupportedLanguage.resolved(from: Locale(identifier: "zh-CN")) == .zhHans)
        #expect(L10n.SupportedLanguage.resolved(from: Locale(identifier: "zh-Hans-CN")) == .zhHans)
        #expect(L10n.SupportedLanguage.resolved(from: Locale(identifier: "zh-Hant-TW")) == .zhHans)
        #expect(L10n.SupportedLanguage.resolved(from: Locale(identifier: "en-US")) == .enUS)
        #expect(L10n.SupportedLanguage.resolved(from: Locale(identifier: "ja-JP")) == .enUS)
    }

    @Test("切换语言时取到不同译文")
    func switchesLanguage() {
        var zhHans = ""
        var enUS = ""
        withLanguage(.zhHans) { zhHans = L10n.Nav.articles }
        withLanguage(.enUS) { enUS = L10n.Nav.articles }

        #expect(!zhHans.isEmpty)
        #expect(!enUS.isEmpty)
        #expect(zhHans != enUS)
    }

    @Test("单参数插值按语言代入，不残留 {name}")
    func interpolatesSingleParameter() {
        for language in L10n.SupportedLanguage.allCases {
            withLanguage(language) {
                let text = L10n.Connect.lastUsed(date: "2026-03-04")
                #expect(text.contains("2026-03-04"), "译文丢了 {date} 参数：\(text)")
                #expect(!text.contains("{"), "译文残留了占位符：\(text)")
            }
        }
    }

    @Test("多参数插值按参数名代入，顺序不敏感")
    func interpolatesMultipleParameters() {
        for language in L10n.SupportedLanguage.allCases {
            withLanguage(language) {
                let text = L10n.Capture.transcribingCount(done: "2", total: "5")
                #expect(text.contains("2"), "译文丢了 {done} 参数：\(text)")
                #expect(text.contains("5"), "译文丢了 {total} 参数：\(text)")
                #expect(!text.contains("{"), "译文残留了占位符：\(text)")
            }
        }
    }

    @Test("Swift 保留字 key 用反引号访问")
    func keywordIdentifiers() {
        withLanguage(.zhHans) {
            #expect(!L10n.Common.`import`.isEmpty)
            #expect(!L10n.Visibility.`private`.isEmpty)
            #expect(!L10n.Visibility.`public`.isEmpty)
            #expect(!L10n.Transfer.`import`.isEmpty)
        }
    }
}
