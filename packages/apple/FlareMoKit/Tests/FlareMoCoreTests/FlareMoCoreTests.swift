import Testing
@testable import FlareMoCore

@Suite("FlareMoKit 内核")
struct FlareMoCoreBasics {
    @Test("内核版本非空")
    func versionIsSet() {
        #expect(!FlareMoCore.version.isEmpty)
    }
}
