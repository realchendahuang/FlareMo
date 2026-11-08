import Foundation

/// 本文件负责：`FlareMoCore/API` 的错误类型。
///
/// 三层错误各管一段，互不混杂：
/// 1. `FlareMoAPIError` —— 门面（`FlareMoAPIClient`、`TokenManager`）对外的统一错误，
///    把 HTTP 状态码 / 传输失败 / 解码失败 / 401 映射成 UI 能分支处理的几种情况；
/// 2. `DeviceAuthorizationError` —— 设备授权（RFC 8628）状态机的终止原因。
///    按 docs/native-clients.md §4.9 / `docs/agent-access-design.md` §4，配对只有
///    「被拒 / 过期 / 本地超时 / 网络/协议失败」四类结局，调用方据此决定文案与
///    「重试配对 / 重新生成配对码」；
/// 3. `TokenStoreError` —— Keychain 读写失败（真实钥匙串实现用，单测不碰）。
public enum FlareMoAPIError: Error, Sendable, Equatable {
    /// 实例地址不是合法的 http(s) URL（登录页输入校验失败）。
    case invalidBaseURL(String)
    /// 本地没有任何凭据：还没配对（或已被 signOut）。
    case notAuthenticated
    /// 401/403，或 refresh token 已失效：需要重新配对。
    case unauthorized
    /// 404：旧实例没有该端点（例如 `/api/app/instance`），调用方降级即可。
    case notFound
    /// 其它非 2xx。`message` 取自服务端的错误信封（见 `APITransport`）。
    case server(status: Int, message: String?)
    /// 网络层失败（连接失败、超时、TLS……），以及无法归类的协议层失败。
    case transport(String)
    /// 2xx 但响应体解不出来（服务端契约漂移）。
    case decoding(String)
}

/// 设备授权轮询的终止原因。
///
/// 只保留四个 case，是因为 UI 只需要这四种分支：
/// - `.denied`：用户在浏览器里拒绝了配对 → 文案「已拒绝」，可重新发起；
/// - `.expired`：配对码过期/已被用过（服务端 `expired_token` / `invalid_grant`）→
///   让用户重新生成配对码；
/// - `.timedOut`：本地等待窗口用尽（服务端一直 pending 超过 `expires_in`）→
///   等价于过期，但强调「本地等太久了」；
/// - `.network`：网络/协议层失败（连不上、5xx、响应解不出来）→ 允许重试。
public enum DeviceAuthorizationError: Error, Sendable, Equatable {
    case denied
    case expired
    case timedOut
    case network(String)
}

/// Keychain 读写失败。真实实现（`KeychainTokenStore`）用；单测走内存 fake，
/// 不触发钥匙串授权弹窗，所以测试里不会出现这个错误。
public enum TokenStoreError: Error, Sendable, Equatable {
    /// `SecItem*` 返回了非 `errSecSuccess` 的状态码。
    case keychainStatus(Int32)
    /// Keychain 里存的字节不是本客户端写入的 JSON。
    case invalidPayload
}

// MARK: - LocalizedError

extension FlareMoAPIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let value):
            return "实例地址必须是 http(s) URL：\(value)"
        case .notAuthenticated:
            return "还没有连接实例，请先完成配对"
        case .unauthorized:
            return "访问令牌已失效，请重新配对"
        case .notFound:
            return "实例没有这个接口（可能是旧版本）"
        case .server(let status, let message):
            return message ?? "实例返回 HTTP \(status)"
        case .transport(let message):
            return "网络错误：\(message)"
        case .decoding(let message):
            return "实例响应无法解析：\(message)"
        }
    }
}

extension DeviceAuthorizationError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .denied:
            return "配对请求已被拒绝"
        case .expired:
            return "配对码已过期或已被使用，请重新生成"
        case .timedOut:
            return "等待配对超时，请重新生成配对码"
        case .network(let message):
            return "配对过程网络出错：\(message)"
        }
    }
}

extension TokenStoreError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .keychainStatus(let status):
            return "钥匙串读写失败（OSStatus \(status)）"
        case .invalidPayload:
            return "钥匙串里的凭据格式不合法"
        }
    }
}
