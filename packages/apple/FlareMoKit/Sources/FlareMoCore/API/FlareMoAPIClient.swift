import Foundation

/// 本文件负责：`FlareMoCore/API` 的门面 —— 统一「实例 baseURL + Bearer + 错误映射」，
/// 给 App 登录流程与同步引擎提供最小、稳定的入口。
///
/// 这一层刻意很薄：只做
/// 1. 实例地址归一化（登录页用户输入 URL → 可信 `URL`）；
/// 2. 无认证的 `instance()`（能力发现，§4.6）与带 Bearer 的 `health()`；
/// 3. 一个 `@Sendable () async throws -> String` 的 token 闭包，可直接喂给
///    `SyncHTTPConfiguration(baseURL:accessToken:session:)`（见
///    `Sources/FlareMoCore/Sync/URLSessionSyncTransport.swift`），从而把刷新逻辑
///    收敛在 API 层、同步层完全无感。
///
/// 不在这里实现备忘录 CRUD / 同步 / 附件：那些已经有 `MemoStore`、`SyncEngine`、
/// 未来附件层的专门入口；门面只负责「连上实例」。
public struct FlareMoAPIClient: Sendable {
    /// 实例根地址（末尾无斜杠，例如 `https://kosx.example.com`）。
    public let baseURL: URL
    public let session: URLSession
    public let tokenManager: TokenManager

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        credentialStore: any TokenStoring
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenManager = TokenManager(store: credentialStore, session: session)
    }

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenManager: TokenManager
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenManager = tokenManager
    }

    /// 登录页用：用户输入的实例地址 → 归一化的 `URL`。
    /// 非法输入抛 `FlareMoAPIError.invalidBaseURL`。
    public init(
        baseURLString: String,
        session: URLSession = .shared,
        credentialStore: any TokenStoring
    ) throws {
        self.init(
            baseURL: try Self.normalizeBaseURL(baseURLString),
            session: session,
            credentialStore: credentialStore)
    }

    // MARK: - 实例地址

    /// 归一化用户输入的实例地址：去空白、只允许 http(s)、小写 host、去掉尾部 `/`。
    ///
    /// 自托管实例可能带端口（`http://192.168.1.2:8787`），端口保留；query/fragment
    /// 视为非法（实例地址不该带它们）。路径前缀保留（少数反向代理会挂在子路径下）。
    public static func normalizeBaseURL(_ raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw FlareMoAPIError.invalidBaseURL(raw) }
        guard var components = URLComponents(string: trimmed),
            let scheme = components.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = components.host, !host.isEmpty,
            components.user == nil, components.password == nil,
            components.query == nil, components.fragment == nil
        else {
            throw FlareMoAPIError.invalidBaseURL(raw)
        }
        components.scheme = scheme
        components.host = host.lowercased()
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        components.path = path
        guard let url = components.url else { throw FlareMoAPIError.invalidBaseURL(raw) }
        return url
    }

    // MARK: - 匿名能力发现

    /// `GET /api/app/instance`（匿名、可缓存；§4.6）。
    ///
    /// 旧实例 404 时抛 `.notFound` —— 调用方按「缺失能力不阻塞启动」降级（§7.6）。
    /// 响应里的 `api_versions` 现有 `InstanceCapabilities` 模型没有建模，会被忽略
    /// （不允许改同步层契约，所以这里不扩它）。
    public func instance() async throws -> InstanceCapabilities {
        var request = URLRequest(url: endpoint("api/app/instance"))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data = try await APITransport.send(request, session: session)
        return try APITransport.decode(InstanceCapabilities.self, from: data)
    }

    // MARK: - 已认证

    /// `GET /api/app/health`（带 Bearer）。
    ///
    /// 服务端这个端点走 `getRequestContext`，接受 PAT/Bearer；返回产品名、实例版本、
    /// 更新仓库等非敏感信息（`apps/worker/src/routes/app/me.ts`）。
    public func health() async throws -> FlareMoHealth {
        let data = try await authorizedGet("api/app/health")
        return try APITransport.decode(FlareMoHealth.self, from: data)
    }

    /// 当前 access token（必要时自动续期）。UI 显示连接状态时用。
    public func currentAccessToken() async throws -> String {
        try await tokenManager.currentAccessToken()
    }

    /// 交给同步引擎的 token 闭包：
    ///
    /// ```swift
    /// let configuration = SyncHTTPConfiguration(
    ///     baseURL: apiClient.baseURL,
    ///     accessToken: apiClient.accessTokenProvider())
    /// let transport = URLSessionSyncTransport(configuration: configuration)
    /// ```
    public func accessTokenProvider() -> @Sendable () async throws -> String {
        let tokenManager = self.tokenManager
        return { try await tokenManager.currentAccessToken() }
    }

    // MARK: - 登录流程的收尾

    /// 配对成功后把令牌落库（连同实例 baseURL），返回保存的凭据。
    ///
    /// 这是 App 登录流程的最后一步：
    /// `DeviceAuthorizationClient.start` → 展示 `userCode` / `verificationURI`
    /// → `poll` 拿到 `IssuedTokens` → `FlareMoAPIClient.savePairing(...)`。
    @discardableResult
    public func savePairing(
        _ tokens: IssuedTokens,
        clientName: String? = nil,
        now: Date = Date()
    ) async throws -> StoredCredentials {
        let credentials = StoredCredentials(
            baseURL: baseURL,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessExpiresAt: now.addingTimeInterval(TimeInterval(max(0, tokens.expiresIn))),
            scope: tokens.scope.isEmpty ? nil : tokens.scope,
            clientName: clientName)
        try await tokenManager.save(credentials)
        return credentials
    }

    /// 本机已保存的凭据（不触发网络）。
    public func credentials() async throws -> StoredCredentials? {
        try await tokenManager.credentials()
    }

    /// 断开连接：清本地凭据 + 缓存。服务端吊销要去 Web「已连接应用」页（§8 第 8 条）。
    public func signOut() async throws {
        try await tokenManager.clear()
    }

    // MARK: - 内部

    private func endpoint(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    /// 带 Bearer 的 GET；401 时强制刷新一次再重试（本地时钟不准 / token 被提前撤销）。
    private func authorizedGet(_ path: String) async throws -> Data {
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "Bearer \(try await tokenManager.currentAccessToken())",
            forHTTPHeaderField: "Authorization")

        do {
            return try await APITransport.send(request, session: session)
        } catch FlareMoAPIError.unauthorized {
            // 刷新失败会抛 .notAuthenticated/.unauthorized，交给上层提示重新配对。
            _ = try await tokenManager.forceRefresh()
            request.setValue(
                "Bearer \(try await tokenManager.currentAccessToken())",
                forHTTPHeaderField: "Authorization")
            return try await APITransport.send(request, session: session)
        }
    }
}

/// `GET /api/app/health` 的响应（`apps/worker/src/routes/app/me.ts`）。
///
/// 字段全部是展示用的非敏感信息；`ok` 是服务端约定的「实例活着」。用
/// `convertFromSnakeCase` 解码，所以 Swift 属性名里的 `Url`（不是 `URL`）才对应
/// 线上的 `_url` 后缀。
public struct FlareMoHealth: Codable, Sendable, Hashable {
    public var ok: Bool
    public var product: String?
    public var version: String?
    public var updateRepository: String?
    public var updateWorkflowUrl: String?
    public var releasesUrl: String?
    public var updateGuideUrl: String?
    /// `team` / `solo`（向量分区布局，见 docs/vector-namespace-design.md）。
    public var teamLayout: String?
    /// `none` / 具体邮件服务商；用来解释「忘记密码」入口为何关闭。
    public var emailProvider: String?

    public init(
        ok: Bool,
        product: String? = nil,
        version: String? = nil,
        updateRepository: String? = nil,
        updateWorkflowUrl: String? = nil,
        releasesUrl: String? = nil,
        updateGuideUrl: String? = nil,
        teamLayout: String? = nil,
        emailProvider: String? = nil
    ) {
        self.ok = ok
        self.product = product
        self.version = version
        self.updateRepository = updateRepository
        self.updateWorkflowUrl = updateWorkflowUrl
        self.releasesUrl = releasesUrl
        self.updateGuideUrl = updateGuideUrl
        self.teamLayout = teamLayout
        self.emailProvider = emailProvider
    }
}
