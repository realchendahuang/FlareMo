import FlareMoDesign
import SwiftUI

/// 设置窗。
///
/// v1 只放三组真东西：外观、同步状态、关于。**不放没实现的开关**——
/// 这是仓库规则（「前端只展示已经接上后端能力的入口」）。
public struct FMSettingsView: View {
    @State private var appearance: FMAppearancePreference = .system

    public init() {}

    public var body: some View {
        Form {
            Section("外观") {
                Picker("外观", selection: $appearance) {
                    ForEach(FMAppearancePreference.allCases) { preference in
                        Text(preference.title).tag(preference)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Section("同步") {
                LabeledContent("实例") {
                    Text("尚未连接")
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
                LabeledContent("上次同步") {
                    Text("—")
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
            }

            Section("关于") {
                LabeledContent("版本") {
                    Text(FMAppInfo.version)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
                LabeledContent("本地库") {
                    Text("\(FMAppInfo.localDatabaseSize)")
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 380)
        .background(FMColor.background.color)
    }
}

/// 外观偏好。`system` 跟随系统，其余强制。
public enum FMAppearancePreference: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }
}

/// App 元信息。版本号从生成的常量读，不散落各处。
public enum FMAppInfo {
    public static let version = "0.1.0 (1)"

    /// 本地库当前占用。接上 GRDB 后改成真实测量。
    public static let localDatabaseSize = "—"
}
