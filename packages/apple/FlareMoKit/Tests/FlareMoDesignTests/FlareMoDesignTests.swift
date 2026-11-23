import Testing
@testable import FlareMoDesign

/// FlareMoDesign 的 target 设了 `defaultIsolation(MainActor.self)`，
/// 所以连它的静态常量都是 MainActor 隔离的——测试套件也要标 @MainActor。
@MainActor
@Suite("设计系统")
struct FlareMoDesignBasics {
    @Test("设计系统版本非空")
    func versionIsSet() {
        #expect(!FlareMoDesign.version.isEmpty)
    }
}
