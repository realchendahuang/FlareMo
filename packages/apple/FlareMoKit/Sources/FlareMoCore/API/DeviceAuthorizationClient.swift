import Foundation

/// 本文件负责：设备授权（RFC 8628「配对码」）客户端 —— 申请配对码、轮询兑换令牌、
/// 以及 refresh token 续期。
///
/// 对应服务端实现：`apps/worker/src/routes/connect-api.ts`（`POST /connect/device`、
/// `POST /connect/token`）。协议契约见 `docs/agent-access-design.md` §4，
/// `docs/native-clients.md` §4.9（续期走 refresh token，纯 PAT 换发还没实现）。
///
/// 轮询状态机（与服务端 `DeviceFlowError` 的 code 一一对应）：
///
/// | 服务端返回 | 状态机动作 |
/// | --- | --- |
/// | 200 + token 响应 | 成功返回 `IssuedTokens` |
/// | 400 `authorization_pending` | 等 `interval` 秒继续 |
/// | 400/429 `slow_down` | `interval += 5`（上限 60）后继续 |
/// | 400 `access_denied` | 终止 → `.denied` |
/// | 400 `expired_token` / `invalid_grant` | 终止 → `.expired`（配对码不可再用） |
/// | 其它 4xx/5xx、网络失败、响应解码失败 | 终止 → `.network(...)` |
///
/// **`sleep` 必须可注入**：生产默认走 `Task.sleep(for:)`，单测注入「记录 + 推进假时钟」
/// 的闭包，否则轮询测试会真的等 5 秒一拍。
public struct DeviceAuthorizationClient: Sendable {
    public let baseURL: URL
    public let session: URLSession
    /// 轮询间隔的等待实现。默认 `Task.sleep(for:)`。
    public let sleep: @Sendable (Duration) async throws -> Void
    /// 当前时间。注入假时钟后，`expires_in` 的超时判定可以在单测里确定地触发。
    public let now: @Sendable () -> Date

    /// 轮询次数上限的安全网（服务端常量 `DEVICE_POLL_MAX_ATTEMPTS = 60`；
    /// 正常情况由 `expires_in` 先到，这里只防止服务端异常时死循环）。
    public static let maxPollAttempts = 64

    public static let defaultSleep: @Sendable (Duration) async throws -> Void = { duration in
        try await _Concurrency.Task<Never, Never>.sleep(for: duration)
    }

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        sleep: @escaping @Sendable (Duration) async throws -> Void = DeviceAuthorizationClient
            .defaultSleep,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.sleep = sleep
        self.now = now
    }

    // MARK: - 1. 申请配对码

    /// `POST /connect/device`。
    ///
    /// - Parameters:
    ///   - clientName: 显示在「已连接应用」里的名字（服务端 1–80 字符）。
    ///   - clientType: 服务端 `APP_CLIENT_TYPES` 只有 `device` / `web` / `script`
    ///     三个值；Apple 端用 `.device`（契约里的 `mac` 会被服务端 400 拒掉，见回报）。
    ///   - scopes: 默认 `["notes"]`；`admin` scope 服务端可能不允许设备流申请。
    public func start(
        clientName: String,
        clientType: DeviceClientType = .device,
        scopes: [String] = ["notes"]
    ) async throws -> DeviceAuthorization {
        var request = URLRequest(url: endpoint("connect/device"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let body = StartRequestBody(
            clientName: clientName, clientType: clientType.rawValue, scopes: scopes)
        do {
            request.httpBody = try APITransport.encoder.encode(body)
        } catch {
            throw DeviceAuthorizationError.network("配对请求编码失败：\(error)")
        }

        let data = try await send(request)
        let wire: StartResponse
        do {
            wire = try APITransport.decoder.decode(StartResponse.self, from: data)
        } catch {
            throw DeviceAuthorizationError.network("配对响应解析失败：\(error)")
        }
        guard let verificationURI = URL(string: wire.verificationUri),
            verificationURI.scheme != nil
        else {
            throw DeviceAuthorizationError.network(
                "配对响应里的 verification_uri 不是合法 URL：\(wire.verificationUri)")
        }
        let verificationURIComplete =
            wire.verificationUriComplete.flatMap(URL.init(string:)) ?? verificationURI

        let expiresIn = (wire.expiresIn ?? 0) > 0 ? (wire.expiresIn ?? 300) : 300
        let rawInterval = wire.interval ?? 0
        let interval = rawInterval > 0 ? min(max(rawInterval, 1), 60) : 5
        return DeviceAuthorization(
            deviceCode: wire.deviceCode,
            userCode: wire.userCode,
            verificationURI: verificationURI,
            verificationURIComplete: verificationURIComplete,
            expiresIn: expiresIn,
            interval: interval,
            receivedAt: now())
    }

    // MARK: - 2. 轮询兑换

    /// 按 RFC 8628 轮询 `POST /connect/token`，直到成功或终止。
    ///
    /// 首次请求立即发出（不先等一个 interval），之后按服务端给的 `interval` 间隔；
    /// `slow_down` 会让间隔 +5 秒。取消（`Task.cancel`）会抛 `CancellationError`。
    public func poll(_ authorization: DeviceAuthorization) async throws -> IssuedTokens {
        var interval = min(max(authorization.interval, 1), 60)
        let deadline = authorization.expiresAt
        var attempts = 0

        while true {
            if now() >= deadline {
                throw DeviceAuthorizationError.timedOut
            }
            attempts += 1
            if attempts > Self.maxPollAttempts {
                throw DeviceAuthorizationError.timedOut
            }

            let outcome = try await requestToken(
                fields: [
                    ("grant_type", Self.deviceCodeGrantType),
                    ("device_code", authorization.deviceCode),
                ])

            switch outcome {
            case .issued(let tokens):
                return tokens
            case .pending:
                try await wait(seconds: interval)
            case .slowDown:
                interval = min(interval + 5, 60)
                try await wait(seconds: interval)
            case .denied:
                throw DeviceAuthorizationError.denied
            case .expired:
                throw DeviceAuthorizationError.expired
            case .failure(let message):
                throw DeviceAuthorizationError.network(message)
            }
        }
    }

    // MARK: - 3. 续期

    /// `POST /connect/token` + `grant_type=refresh_token`。
    ///
    /// 服务端每次刷新都会**轮换** access token 与 refresh token（旧的一对立即失效，
    /// 见 `connect-api.ts` 的 refresh 分支）；调用方必须把返回的新 refreshToken 存回去，
    /// 否则下一次续期会拿到 `invalid_grant`。
    public func refresh(refreshToken: String) async throws -> IssuedTokens {
        let outcome = try await requestToken(
            fields: [
                ("grant_type", Self.refreshTokenGrantType),
                ("refresh_token", refreshToken),
            ])
        switch outcome {
        case .issued(let tokens):
            return tokens
        case .expired, .denied:
            throw DeviceAuthorizationError.expired
        case .pending:
            throw DeviceAuthorizationError.network("刷新令牌时服务端仍返回 authorization_pending")
        case .slowDown:
            throw DeviceAuthorizationError.network("刷新令牌被限流（slow_down）")
        case .failure(let message):
            throw DeviceAuthorizationError.network(message)
        }
    }

    // MARK: - 内部

    static let deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code"
    static let refreshTokenGrantType = "refresh_token"

    private func endpoint(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    private func wait(seconds: Int) async throws {
        do {
            try await sleep(.seconds(seconds))
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw DeviceAuthorizationError.network("轮询等待失败：\(error)")
        }
    }

    private func send(_ request: URLRequest) async throws -> Data {
        do {
            return try await APITransport.send(request, session: session)
        } catch let error as FlareMoAPIError {
            throw DeviceAuthorizationError.network(Self.describe(error))
        }
    }

    /// 发一次 token 请求，并把 OAuth 错误码翻成状态机动作。
    ///
    /// 这里没复用 `APITransport.send`，因为轮询需要区分 400 里的 `error` 码
    /// （`authorization_pending` / `slow_down` …），而 `APITransport.send` 会把
    /// 非 2xx 一律折叠成 `FlareMoAPIError`。
    private func requestToken(fields: [(String, String)]) async throws -> TokenPollOutcome {
        var request = URLRequest(url: endpoint("connect/token"))
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = APITransport.formURLEncoded(fields)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw DeviceAuthorizationError.network(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw DeviceAuthorizationError.network("非 HTTP 响应")
        }

        if (200..<300).contains(http.statusCode) {
            do {
                let wire = try APITransport.decoder.decode(TokenResponse.self, from: data)
                guard let accessToken = wire.accessToken, !accessToken.isEmpty,
                    let refreshToken = wire.refreshToken, !refreshToken.isEmpty
                else {
                    throw DeviceAuthorizationError.network("token 响应缺少 access_token / refresh_token")
                }
                return .issued(
                    IssuedTokens(
                        accessToken: accessToken,
                        tokenType: wire.tokenType ?? "Bearer",
                        expiresIn: wire.expiresIn ?? 0,
                        refreshToken: refreshToken,
                        scope: wire.scope ?? ""))
            } catch let error as DeviceAuthorizationError {
                throw error
            } catch {
                throw DeviceAuthorizationError.network("token 响应解析失败：\(error)")
            }
        }

        // 400/429：OAuth 错误码。
        let oauth = try? APITransport.decoder.decode(OAuthErrorResponse.self, from: data)
        let code = oauth?.error
        let description = oauth?.errorDescription

        if http.statusCode == 429, code == nil || code == "slow_down" {
            return .slowDown
        }
        switch code {
        case "authorization_pending":
            return .pending
        case "slow_down":
            return .slowDown
        case "access_denied":
            return .denied
        case "expired_token", "invalid_grant":
            return .expired
        case "invalid_request", "unsupported_grant_type":
            return .failure(description ?? code ?? "HTTP \(http.statusCode)")
        default:
            let message =
                description
                ?? APITransport.errorMessage(from: data)
                ?? "HTTP \(http.statusCode)"
            return .failure(message)
        }
    }

    private static func describe(_ error: FlareMoAPIError) -> String {
        switch error {
        case .invalidBaseURL(let value): return "实例地址不合法：\(value)"
        case .notAuthenticated: return "还没有连接实例"
        case .unauthorized: return "HTTP 401（配对端点不应要求认证）"
        case .notFound: return "HTTP 404（实例没有配对端点，可能是旧版本）"
        case .server(let status, let message): return message ?? "HTTP \(status)"
        case .transport(let message): return message
        case .decoding(let message): return message
        }
    }
}

/// `POST /connect/device` 的 `client_type`。
///
/// 取值**必须**是服务端 `APP_CLIENT_TYPES` 的枚举：`device` / `web` / `script`
/// （`packages/contracts/src/agent-access.ts`，`connect-api.ts` 的 zod 校验）。
/// 传其它值（例如 `mac`）服务端会 400。
public enum DeviceClientType: String, Codable, Sendable, Hashable, CaseIterable {
    /// 无回调地址的本地客户端（桌面 App / CLI / Agent）。Apple 端用这个。
    case device
    /// 有回调地址的 Web 客户端（OAuth 授权码流程预留）。
    case web
    /// 无交互脚本。
    case script
}

/// `POST /connect/device` 的响应（已做默认值归一）。
public struct DeviceAuthorization: Codable, Sendable, Hashable {
    public let deviceCode: String
    public let userCode: String
    /// 用户在浏览器里打开并输入配对码的页面。
    public let verificationURI: URL
    /// 带 `?code=` 的直达链接（服务端叫 `verification_uri_complete`；缺省时回落
    /// 到 `verificationURI`，所以这里是非可选的）。
    public let verificationURIComplete: URL
    public let expiresIn: Int
    public let interval: Int
    /// 拿到这个响应的时间；`poll` 用它算 `expiresAt`，避免「UI 展示一会儿再轮询」
    /// 把有效窗口算长。
    public let receivedAt: Date

    public init(
        deviceCode: String,
        userCode: String,
        verificationURI: URL,
        verificationURIComplete: URL? = nil,
        expiresIn: Int,
        interval: Int,
        receivedAt: Date = Date()
    ) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.verificationURIComplete = verificationURIComplete ?? verificationURI
        self.expiresIn = expiresIn
        self.interval = interval
        self.receivedAt = receivedAt
    }

    public var expiresAt: Date {
        receivedAt.addingTimeInterval(TimeInterval(max(0, expiresIn)))
    }
}

/// `POST /connect/token` 的成功响应。
public struct IssuedTokens: Codable, Sendable, Hashable {
    /// `memos_pat_…`；直接放进 `Authorization: Bearer`。
    public let accessToken: String
    public let tokenType: String
    /// access token 有效期（秒）。服务端现在是 14 天 = 1_209_600。
    public let expiresIn: Int
    /// 续期凭据。**每次 refresh 都会轮换**，必须整体覆盖保存。
    public let refreshToken: String
    public let scope: String

    public init(
        accessToken: String,
        tokenType: String = "Bearer",
        expiresIn: Int,
        refreshToken: String,
        scope: String = ""
    ) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.refreshToken = refreshToken
        self.scope = scope
    }
}

// MARK: - 线格式

/// `/connect/device` 请求体（`APITransport.encoder` 会把 camelCase 转 snake_case）。
private struct StartRequestBody: Encodable {
    var clientName: String
    var clientType: String
    var scopes: [String]
}

/// `/connect/device` 响应体。字段可选 + 默认值，旧实例少字段时不至于整条炸掉。
private struct StartResponse: Decodable {
    var deviceCode: String
    var userCode: String
    var verificationUri: String
    var verificationUriComplete: String?
    var expiresIn: Int?
    var interval: Int?
}

/// `/connect/token` 成功响应体。
private struct TokenResponse: Decodable {
    var accessToken: String?
    var tokenType: String?
    var expiresIn: Int?
    var refreshToken: String?
    var scope: String?
}

/// `/connect/token` 错误响应体（RFC 8628 §3.5）。
private struct OAuthErrorResponse: Decodable {
    var error: String?
    var errorDescription: String?
}

/// token 端点一次请求的语义化结果。
private enum TokenPollOutcome {
    case issued(IssuedTokens)
    case pending
    case slowDown
    case denied
    case expired
    case failure(String)
}
