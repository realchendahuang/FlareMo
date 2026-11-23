import Foundation
import Security

/// 本文件负责：凭据的持久化抽象与 Keychain 实现。
///
/// 设计（`docs/agent-access-design.md` §6 / §8）：
/// - 一个实例一份凭据：access token（14 天）+ refresh token（90 天，**每次刷新轮换**）
///   + access 过期时间 + 实例 baseURL + 显示用客户端名；
/// - 凭据只存客户端安全存储（macOS/iOS = Keychain），不写日志、不进 UserDefaults；
/// - 协议 `TokenStoring` 抽出来，单测用内存 fake，**绝不碰真钥匙串**（会弹授权窗口，
///   CI / 无人值守环境直接卡住）。
///
/// 为什么手写 `SecItem` 而不引第三方：§5.3 的依赖白名单里 Keychain 只有 Valet
/// （可选替代）；这里只有 100 行读写，自己封装可以少一个依赖，也能精确控制
/// `kSecAttrAccessible`。
public struct StoredCredentials: Codable, Sendable, Hashable {
    /// 实例根地址（配对时填写，末尾无斜杠）。
    public var baseURL: URL
    public var accessToken: String
    public var refreshToken: String
    /// access token 的过期时刻（本地时钟）。提前若干秒刷新，见 `TokenManager`。
    public var accessExpiresAt: Date
    /// 服务端返回的 `scope` 原样保存（`"notes"` / `"notes admin"`）。
    public var scope: String?
    /// 「谁连了我的库」在客户端侧的显示名（服务端 `client_name`）。
    public var clientName: String?

    public init(
        baseURL: URL,
        accessToken: String,
        refreshToken: String,
        accessExpiresAt: Date,
        scope: String? = nil,
        clientName: String? = nil
    ) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessExpiresAt = accessExpiresAt
        self.scope = scope
        self.clientName = clientName
    }

    /// access token 是否还「够用」：剩余有效期大于 `leeway` 秒。
    /// 默认留 60 秒余量，避免卡在过期边界上发出 401。
    public func isAccessTokenFresh(now: Date = Date(), leeway: TimeInterval = 60) -> Bool {
        accessExpiresAt.timeIntervalSince(now) > leeway
    }
}

/// 凭据存储抽象。真实实现是 `KeychainTokenStore`；单测注入内存 fake。
public protocol TokenStoring: Sendable {
    func load() async throws -> StoredCredentials?
    func save(_ credentials: StoredCredentials) async throws
    func clear() async throws
}

/// Keychain 实现：`kSecClassGenericPassword` + service/account 定位一条凭据。
///
/// - `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`：设备解锁过一次后可读
///   （后台同步需要），**不随 iCloud Keychain 同步**（凭据是单设备授权，不是账号级）。
/// - 单测不实例化它（构造本身不碰 Keychain，但 load/save 会），只保证编译通过与
///   `StoredCredentials` 的 Codable 保真。
public struct KeychainTokenStore: TokenStoring {
    public let service: String
    public let account: String

    public init(
        service: String = "app.flaremo.credentials",
        account: String = "default"
    ) {
        self.service = service
        self.account = account
    }

    public func load() async throws -> StoredCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { throw TokenStoreError.invalidPayload }
            do {
                return try Self.decoder.decode(StoredCredentials.self, from: data)
            } catch {
                throw TokenStoreError.invalidPayload
            }
        case errSecItemNotFound:
            return nil
        default:
            throw TokenStoreError.keychainStatus(status)
        }
    }

    public func save(_ credentials: StoredCredentials) async throws {
        let data: Data
        do {
            data = try Self.encoder.encode(credentials)
        } catch {
            throw TokenStoreError.invalidPayload
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw TokenStoreError.keychainStatus(updateStatus)
        }

        var addQuery = baseQuery
        addQuery.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw TokenStoreError.keychainStatus(addStatus)
        }
    }

    public func clear() async throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TokenStoreError.keychainStatus(status)
        }
    }

    // MARK: - 内部

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        // 凭据本身是 JSON 文本存在 Keychain 里；ISO-8601 方便出问题时人工查看。
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
