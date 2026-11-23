import Foundation

/// 本文件负责：凭据生命周期管理 —— 读凭据、过期前自动用 refresh token 续期、
/// 轮换后的新凭据写回存储。
///
/// 为什么单独一个 `actor`：
/// - refresh token **每次刷新都会轮换**（服务端 `connect-api.ts` refresh 分支会吊销
///   旧的 access token 并把旧 refresh token 作废，`docs/agent-access-design.md` §6）。
///   如果同步引擎、UI、附件上传并发触发刷新，两路会互相把对方的 refresh token 作废，
///   直接掉线。actor 串行化 + `refreshInFlight` 单飞保证「同一时刻只有一个刷新请求」；
/// - 凭据读取/写回要与刷新保持一致，不能让旧 token 覆盖新 token。
///
/// 时钟与存储都可注入：单测用假时钟 + 内存 fake 存储，不碰真钥匙串。
public actor TokenManager {
    private let store: any TokenStoring
    private let session: URLSession
    private let refreshLeeway: TimeInterval
    private let now: @Sendable () -> Date
    /// 单飞刷新：并发调用共享同一张 `Task`。
    private var refreshInFlight: _Concurrency.Task<StoredCredentials, Error>?

    /// - Parameters:
    ///   - store: 凭据存储（生产 `KeychainTokenStore`，测试内存 fake）。
    ///   - session: 刷新请求用的 URLSession（测试注入 URLProtocol 桩）。
    ///   - refreshLeeway: 提前多少秒视为「该续期了」，默认 60 秒。
    ///   - now: 当前时间（测试注入假时钟）。
    public init(
        store: any TokenStoring,
        session: URLSession = .shared,
        refreshLeeway: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.session = session
        self.refreshLeeway = refreshLeeway
        self.now = now
    }

    // MARK: - 存储直读

    public func credentials() async throws -> StoredCredentials? {
        try await store.load()
    }

    public func save(_ credentials: StoredCredentials) async throws {
        try await store.save(credentials)
    }

    public func clear() async throws {
        try await store.clear()
    }

    // MARK: - 取 token

    /// 取一个可直接放进 `Authorization: Bearer` 的 access token。
    ///
    /// 剩余有效期 < `refreshLeeway` 时先静默续期：
    /// - 续期成功 → 保存轮换后的新凭据，返回新 access token；
    /// - refresh token 已失效（`expired_token` / `invalid_grant`）→ 清掉本地凭据并抛
    ///   `.unauthorized`（UI 提示重新配对，符合「只有 refresh 过期才需要重新配对」）。
    public func currentAccessToken() async throws -> String {
        guard let credentials = try await store.load() else {
            throw FlareMoAPIError.notAuthenticated
        }
        if credentials.isAccessTokenFresh(now: now(), leeway: refreshLeeway) {
            return credentials.accessToken
        }
        return try await refreshed(credentials).accessToken
    }

    /// 强制续期（收到 401 后使用：本地时钟可能不准，token 也可能被服务端提前撤销）。
    @discardableResult
    public func forceRefresh() async throws -> StoredCredentials {
        guard let credentials = try await store.load() else {
            throw FlareMoAPIError.notAuthenticated
        }
        return try await refreshed(credentials)
    }

    // MARK: - 内部

    private func refreshed(_ credentials: StoredCredentials) async throws -> StoredCredentials {
        if let refreshInFlight {
            return try await refreshInFlight.value
        }
        let task = _Concurrency.Task { [session, now] in
            try await Self.performRefresh(
                credentials, session: session, now: now,
                onInvalidGrant: { [store] in try? await store.clear() })
        }
        refreshInFlight = task
        do {
            let updated = try await task.value
            refreshInFlight = nil
            try await store.save(updated)
            return updated
        } catch {
            refreshInFlight = nil
            throw error
        }
    }

    /// 真正发刷新请求。抽成 static 是为了在 `_Concurrency.Task` 里跑（避免重入 actor）。
    private static func performRefresh(
        _ credentials: StoredCredentials,
        session: URLSession,
        now: @Sendable () -> Date,
        onInvalidGrant: @Sendable () async -> Void
    ) async throws -> StoredCredentials {
        let client = DeviceAuthorizationClient(baseURL: credentials.baseURL, session: session)
        do {
            let tokens = try await client.refresh(refreshToken: credentials.refreshToken)
            var updated = credentials
            updated.accessToken = tokens.accessToken
            // refresh token 轮换：服务端只认新的这一对，必须整体覆盖。
            updated.refreshToken = tokens.refreshToken
            updated.accessExpiresAt = now().addingTimeInterval(
                TimeInterval(max(0, tokens.expiresIn)))
            if !tokens.scope.isEmpty {
                updated.scope = tokens.scope
            }
            return updated
        } catch let error as DeviceAuthorizationError {
            switch error {
            case .expired, .denied:
                // refresh token 已死：本地凭据没有继续使用的意义，清掉逼 UI 重新配对。
                await onInvalidGrant()
                throw FlareMoAPIError.unauthorized
            case .timedOut:
                throw FlareMoAPIError.transport("刷新访问令牌超时")
            case .network(let message):
                throw FlareMoAPIError.transport(message)
            }
        }
    }
}
