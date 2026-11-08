import FlareMoDesign
import FlareMoUI
import SwiftUI

/// iOS App 入口。
///
/// 移动端的第一性原理和桌面不同：打开就是输入框，其余全是次要的。
/// 所以这里用 `FMPhoneRoot`（输入框吸底 + 时间线），而不是把桌面的三栏硬塞进来。
@main
struct FlareMoIOSApp: App {
    var body: some Scene {
        WindowGroup {
            FMPhoneRoot()
                .background(FMColor.background.color)
        }
    }
}
