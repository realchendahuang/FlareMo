import FlareMoCore
import FlareMoDesign
import SwiftUI

/// 设置窗。
///
/// 只放**真的能用的东西**：外观、实例连接、同步状态、版本信息。
/// 没有实现的开关一律不放（仓库规则：前端只展示已接上后端能力的入口）。
public struct FMSettingsView: View {
    @State private var appearance: FMAppearancePreference = .system
    @State private var instanceInput = ""
    @State private var copied = false

    private let sync: FMSyncCoordinator
    private let onAppearance: (FMAppearancePreference) -> Void

    public init(sync: FMSyncCoordinator, onAppearance: @escaping (FMAppearancePreference) -> Void = { _ in }) {
        self.sync = sync
        self.onAppearance = onAppearance
    }

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
                .onChange(of: appearance) { _, newValue in onAppearance(newValue) }
            }

            Section("实例") {
                instanceSection
            }

            Section("关于") {
                LabeledContent("版本") {
                    Text(FMAppInfo.version)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 420)
        .background(FMColor.background.color)
        .task { await sync.restoreSession() }
    }

    // MARK: 实例与同步

    @ViewBuilder
    private var instanceSection: some View {
        switch sync.state {
        case .disconnected:
            TextField("实例地址，如 https://notes.example.com", text: $instanceInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit { sync.connect(instanceURL: instanceInput) }
            Button("连接") { sync.connect(instanceURL: instanceInput) }
                .disabled(instanceInput.trimmingCharacters(in: .whitespaces).isEmpty)
            Text("在本机浏览器里打开实例的「连接应用」页，输入配对码即可。")
                .font(.system(size: 11))
                .foregroundStyle(FMColor.mutedForeground.color)

        case .requestingCode:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("正在向实例申请配对码…")
            }

        case let .awaitingApproval(userCode, verificationURL):
            VStack(alignment: .leading, spacing: 8) {
                Text("配对码")
                    .font(.system(size: 12))
                    .foregroundStyle(FMColor.mutedForeground.color)
                HStack(spacing: 10) {
                    Text(userCode)
                        .font(.system(size: 22, weight: .semibold).monospacedDigit())
                        .textSelection(.enabled)
                    Button(copied ? "已复制" : "复制") {
                        copyToPasteboard(userCode)
                    }
                    .controlSize(.small)
                }
                Link("打开浏览器确认", destination: verificationURL)
                    .font(.system(size: 12))
                Text("在浏览器里确认后，这里会自动连上。")
                    .font(.system(size: 11))
                    .foregroundStyle(FMColor.mutedForeground.color)
                Button("取消") { sync.cancelPairing() }
                    .controlSize(.small)
            }

        case .idle, .syncing:
            LabeledContent("已连接") {
                Text(sync.instanceURL?.absoluteString ?? "—")
                    .font(.system(size: 12))
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .textSelection(.enabled)
            }
            LabeledContent("上次同步") {
                Text(sync.lastSyncedAt.map(FMDateLabel.string) ?? "还没同步过")
                    .font(.system(size: 12).monospacedDigit())
                    .foregroundStyle(FMColor.mutedForeground.color)
            }
            if let summary = sync.lastSummary {
                LabeledContent("结果") {
                    Text(summary)
                        .font(.system(size: 12))
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
            }
            HStack(spacing: 10) {
                Button("立即同步") {
                    _Concurrency.Task { await sync.syncNow() }
                }
                .disabled(sync.state == .syncing)
                if sync.state == .syncing {
                    ProgressView().controlSize(.small)
                }
                Spacer()
                Button("断开") {
                    _Concurrency.Task { await sync.disconnect() }
                }
                .foregroundStyle(FMColor.destructive.color)
            }

        case let .failed(message):
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                    Text("连接失败").font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(FMColor.destructive.color)
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .textSelection(.enabled)
                Button("重试") { sync.connect(instanceURL: instanceInput) }
                    .controlSize(.small)
            }
        }
    }

    private func copyToPasteboard(_ text: String) {
        #if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        #else
            UIPasteboard.general.string = text
        #endif
        copied = true
        _Concurrency.Task {
            try? await _Concurrency.Task.sleep(for: .seconds(1.5))
            copied = false
        }
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

/// App 元信息。
public enum FMAppInfo {
    public static let version = "0.1.0 (1)"
}

/// 时间显示：今天只显示时分，其余显示月日 + 时分。
enum FMDateLabel {
    static func string(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hans_CN")
        if Calendar.current.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
        } else {
            formatter.dateFormat = "M月d日 HH:mm"
        }
        return formatter.string(from: date)
    }
}
