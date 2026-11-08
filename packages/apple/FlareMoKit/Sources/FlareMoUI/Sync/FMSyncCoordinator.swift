import FlareMoCore
import Foundation
import Observation
import SwiftUI

/// 把「连上实例 + 同步」这两件事收在一个对象里，界面只读它的状态。
///
/// 设计上刻意不做成后台守护进程：v1 只在 App 前台跑（进入后台就停），
/// 与 §4.10「不挂长连接、靠推送唤醒 + pull」一致。真后台刷新留给
/// BGTaskScheduler / 桌面定时器，那是 M1 的事。
@MainActor
@Observable
public final class FMSyncCoordinator {
    /// 当前处于哪一步。界面靠它决定显示什么，不需要自己拼状态机。
    public enum State: Equatable {
        /// 没有配对过
        case disconnected
        /// 正在向实例申请配对码
        case requestingCode
        /// 已经拿到配对码，等用户在浏览器里确认
        case awaitingApproval(userCode: String, verificationURL: URL)
        /// 已连接，空闲
        case idle
        case syncing
        case failed(String)
    }

    public private(set) var state: State = .disconnected
    public private(set) var lastSyncedAt: Date?
    /// 上次同步摘要（拉了/推了多少条），界面上给一行小字。
    public private(set) var lastSummary: String?
    /// 已连接的实例地址（来自 Keychain 里的凭据）。
    public private(set) var instanceURL: URL?

    private let database: AppDatabase?
    private let credentialStore: any TokenStoring
    private var engine: SyncEngine?
    // `FlareMoCore` 里有个 `struct Task`（服务端 tasks 表），会遮蔽 `_Concurrency.Task`。
    private var autoSyncTask: _Concurrency.Task<Void, Never>?
    private var pairingTask: _Concurrency.Task<Void, Never>?

    /// 自动同步间隔。30 秒是成本与「像不像实时」的折中：
    /// §9 的成本模型里，这个频率在免费额度内；再快就纯粹是烧配额。
    private static let autoSyncInterval: Duration = .seconds(30)

    public init(database: AppDatabase?, credentialStore: any TokenStoring = KeychainTokenStore()) {
        self.database = database
        self.credentialStore = credentialStore
    }

    // MARK: - 启动时恢复

    /// App 启动时调：Keychain 里有凭据就直接进入可同步状态。
    public func restoreSession() async {
        guard let credentials = try? await credentialStore.load() else {
            state = .disconnected
            return
        }
        instanceURL = credentials.baseURL
        await configureEngine(baseURL: credentials.baseURL)
        state = .idle
        startAutoSync()
    }

    // MARK: - 配对

    /// 用户填完实例地址点「连接」：申请配对码并开始轮询。
    ///
    /// 这里用 `Task` 起轮询而不是 await 到结束，是因为界面要先把 `userCode`
    /// 显示出来（用户得拿它去浏览器里确认），不能卡在 await 上。
    public func connect(instanceURL rawInput: String) {
        pairingTask?.cancel()
        state = .requestingCode
        pairingTask = _Concurrency.Task { [weak self] in
            guard let self else { return }
            do {
                let client = try FlareMoAPIClient(
                    baseURLString: rawInput,
                    credentialStore: credentialStore
                )
                // 先探一下是不是 FlareMo 实例：地址填错了要立刻告诉用户，
                // 而不是让他对着一串轮询失败干等。
                _ = try await client.instance()

                let deviceClient = DeviceAuthorizationClient(baseURL: client.baseURL)
                let authorization = try await deviceClient.start(
                    clientName: Self.clientName,
                    clientType: .device,
                    scopes: ["notes"]
                )
                state = .awaitingApproval(
                    userCode: authorization.userCode,
                    verificationURL: authorization.verificationURIComplete
                )

                let tokens = try await deviceClient.poll(authorization)
                try await client.savePairing(tokens, clientName: Self.clientName)
                instanceURL = client.baseURL
                await configureEngine(baseURL: client.baseURL)
                state = .idle
                startAutoSync()
                await syncNow()
            } catch is CancellationError {
                // 用户主动取消，状态由 cancelPairing 负责重置
            } catch let error as DeviceAuthorizationError {
                state = .failed(Self.describe(error))
            } catch {
                state = .failed(String(describing: error))
            }
        }
    }

    /// 用户放弃配对。
    public func cancelPairing() {
        pairingTask?.cancel()
        pairingTask = nil
        state = .disconnected
    }

    /// 断开：清 Keychain、停同步。
    public func disconnect() async {
        autoSyncTask?.cancel()
        autoSyncTask = nil
        engine = nil
        try? await credentialStore.clear()
        instanceURL = nil
        lastSyncedAt = nil
        lastSummary = nil
        state = .disconnected
    }

    // MARK: - 同步

    /// 手动/自动同步都走这里。并发调用会被 `syncing` 状态挡住（单写者）。
    public func syncNow() async {
        guard let engine else { return }
        if case .syncing = state { return }
        state = .syncing
        let summary = await engine.runOnce()
        if let error = summary.pullError ?? summary.pushError {
            state = .failed(error)
            return
        }
        lastSyncedAt = .now
        lastSummary = Self.describe(summary)
        state = .idle
    }

    private func startAutoSync() {
        autoSyncTask?.cancel()
        autoSyncTask = _Concurrency.Task { [weak self] in
            while !_Concurrency.Task.isCancelled {
                try? await _Concurrency.Task.sleep(for: Self.autoSyncInterval)
                guard !_Concurrency.Task.isCancelled else { return }
                await self?.syncNow()
            }
        }
    }

    // MARK: - 内部

    private func configureEngine(baseURL: URL) async {
        guard let database else { return }
        let client = FlareMoAPIClient(
            baseURL: baseURL,
            credentialStore: credentialStore
        )
        let transport = URLSessionSyncTransport(
            configuration: SyncHTTPConfiguration(
                baseURL: baseURL,
                accessToken: client.accessTokenProvider()
            )
        )
        engine = SyncEngine(database: database, transport: transport)
    }

    private static let clientName: String = {
        #if os(macOS)
            "FlareMo macOS"
        #else
            "FlareMo iOS"
        #endif
    }()

    private static func describe(_ error: DeviceAuthorizationError) -> String {
        switch error {
        case .denied: "配对被拒绝"
        case .expired: "配对码已过期，请重试"
        case .timedOut: "等待确认超时，请重试"
        case .network: "连不上实例，检查地址与网络"
        }
    }

    private static func describe(_ summary: SyncRunSummary) -> String {
        var parts: [String] = []
        if let pull = summary.pull, pull.applied > 0 {
            parts.append("拉取 \(pull.applied) 条")
        }
        if let push = summary.push {
            if push.applied > 0 { parts.append("上送 \(push.applied) 条") }
            if push.conflicts > 0 { parts.append("冲突 \(push.conflicts) 条") }
            if push.retried > 0 { parts.append("重试 \(push.retried) 条") }
        }
        return parts.isEmpty ? "已是最新" : parts.joined(separator: " · ")
    }
}
