#if os(macOS)
import Carbon.HIToolbox
import Foundation

/// 全局热键（默认 ⌘⇧Space）。
///
/// 为什么不用 KeyboardShortcuts 这类库：这个仓库的 Apple 端依赖白名单是**精确版本 + 逐个审过许可证**的，
/// 为一个全局热键引一个包，会把「Xcode 工程也要跟着加 SwiftPM 依赖」这件事一起带进来。
/// Carbon 的 `RegisterEventHotKey` 是 macOS 上唯一稳定的系统级热键 API（十几年没变），
/// 40 行就能包完，而且不需要用户授权「辅助功能」——这比引依赖更划算。
///
/// 注意：Carbon 虽然老，但 Apple 没有弃用这两个符号；ARC 下用 Unmanaged 手动管引用。
@MainActor
public final class FMGlobalHotkey {
    /// 热键触发时回调（在主线程）。
    private var handler: (() -> Void)?
    // Carbon 的引用是裸指针，deinit（nonisolated）里也要能反注册，
    // 所以标 nonisolated(unsafe)：它们的生命周期只在这里管，没有并发访问。
    nonisolated(unsafe) private var hotKeyRef: EventHotKeyRef?
    nonisolated(unsafe) private var eventHandlerRef: EventHandlerRef?
    private static let signature: OSType = 0x464C4D4F // 'FLMO'

    public init() {}

    deinit {
        // deinit 在 nonisolated 上下文，直接调 MainActor 方法不允许；
        // 这里用 Carbon 的同步反注册，不碰任何 Swift 状态。
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
    }

    /// 注册 ⌘⇧Space。重复调用会先卸掉旧的。
    public func registerCommandShiftSpace(_ action: @escaping () -> Void) {
        unregister()
        handler = action

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        // 事件回调是 C 函数指针，拿不到 self，所以用全局变量存当前实例。
        // 同一进程只会有一个快速捕获热键，这个妥协是可接受的。
        FMGlobalHotkey.current = self
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, _ -> OSStatus in
                guard let event else { return OSStatus(eventNotHandledErr) }
                var hotKeyID = EventHotKeyID()
                let status = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                guard status == noErr, hotKeyID.signature == FMGlobalHotkey.signature else {
                    return OSStatus(eventNotHandledErr)
                }
                // Carbon 回调在主线程，直接调。
                MainActor.assumeIsolated { FMGlobalHotkey.current?.fire() }
                return noErr
            },
            1,
            &eventType,
            nil,
            &eventHandlerRef
        )

        let hotKeyID = EventHotKeyID(signature: Self.signature, id: 1)
        RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(cmdKey | shiftKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    public func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
        handler = nil
    }

    fileprivate func fire() {
        handler?()
    }

    /// 当前实例（Carbon 回调没有 self，只能这样取）。
    fileprivate static var current: FMGlobalHotkey?
}
#endif
