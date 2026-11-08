import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：凭据存储与续期逻辑的单测 ——
/// `StoredCredentials` 的 Codable 保真、内存版 `TokenStoring` 的读写清除、
/// `TokenManager` 的「新鲜就直取 / 过期才刷新 / 刷新失败清凭据 / 并发只刷一次」。
///
/// **不碰真钥匙串**：`KeychainTokenStore` 只做构造与参数检查，`load/save/clear`
/// 在单测里会弹系统授权窗口，所以全部走 `InMemoryTokenStore`。
@Suite("凭据存储与刷新")
struct APITokenStoreTests {

    private let epoch = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeCredentials(
        baseURL: URL,
        expiresAt: Date,
        accessToken: String = "memos_pat_old",
        refreshToken: String = "refresh-1"
    ) -> StoredCredentials {
        StoredCredentials(
            baseURL: baseURL,
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessExpiresAt: expiresAt,
            scope: "notes",
            clientName: "FlareMo macOS")
    }

    private func makeManager(
        store: InMemoryTokenStore,
        server: APIStubServer,
        clock: FakeClock
    ) -> TokenManager {
        TokenManager(
            store: store,
            session: server.makeSession(),
            refreshLeeway: 60,
            now: { clock.now })
    }

    // MARK: StoredCredentials / 协议

    @Test("StoredCredentials：Codable 往返（URL / Date / 可选 scope）")
    func credentialsCodableRoundTrip() throws {
        let original = StoredCredentials(
            baseURL: URL(string: "https://kosx.example.com")!,
            accessToken: "memos_pat_live",
            refreshToken: "refresh-1",
            accessExpiresAt: Date(timeIntervalSince1970: 1_794_149_131.123),
            scope: "notes",
            clientName: "FlareMo macOS")

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(StoredCredentials.self, from: data)
        #expect(decoded == original)
    }

    @Test("过期判定：留 60 秒余量")
    func freshnessLeeway() {
        let now = epoch
        let fresh = makeCredentials(baseURL: URL(string: "https://x.test")!, expiresAt: now.addingTimeInterval(61))
        let boundary = makeCredentials(
            baseURL: URL(string: "https://x.test")!, expiresAt: now.addingTimeInterval(60))
        let expired = makeCredentials(
            baseURL: URL(string: "https://x.test")!, expiresAt: now.addingTimeInterval(-1))

        #expect(fresh.isAccessTokenFresh(now: now, leeway: 60))
        #expect(!boundary.isAccessTokenFresh(now: now, leeway: 60))
        #expect(!expired.isAccessTokenFresh(now: now, leeway: 60))
    }

    @Test("内存 TokenStore：save → load → clear")
    func inMemoryStoreLifecycle() async throws {
        let store = InMemoryTokenStore()
        let credentials = makeCredentials(
            baseURL: URL(string: "https://x.test")!, expiresAt: epoch.addingTimeInterval(3600))

        #expect(try await store.load() == nil)
        try await store.save(credentials)
        #expect(try await store.load() == credentials)
        try await store.clear()
        #expect(try await store.load() == nil)
        let counters = await store.counters()
        #expect(counters.save == 1)
        #expect(counters.clear == 1)
    }

    @Test("KeychainTokenStore：只做构造（单测不触发钥匙串授权）")
    func keychainStoreConfiguration() {
        let store = KeychainTokenStore(service: "app.flaremo.test", account: "kosx")
        #expect(store.service == "app.flaremo.test")
        #expect(store.account == "kosx")
        // 默认构造也要可用（生产用 service 前缀 + default account）。
        #expect(KeychainTokenStore().account == "default")
    }

    // MARK: TokenManager

    @Test("TokenManager：token 还新鲜时直接返回，不发网络请求")
    func tokenFreshNeedsNoNetwork() async throws {
        let server = APIStubServer()
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(3600))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        #expect(try await manager.currentAccessToken() == "memos_pat_old")
        #expect(server.requestCount == 0)
    }

    @Test("TokenManager：过期前静默刷新，轮换后的 refresh token 必须写回")
    func tokenExpiredRefreshesAndPersistsRotation() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.rotatedTokens)
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(-1))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        let token = try await manager.currentAccessToken()

        #expect(token == "memos_pat_rotated")
        #expect(server.requestCount == 1)
        let request = try #require(server.requests.first)
        #expect(request.path == "/connect/token")

        let persisted = try #require(await store.snapshot())
        #expect(persisted.accessToken == "memos_pat_rotated")
        // 轮换：refresh token 必须更新成新的一对，否则下次刷新 invalid_grant。
        #expect(persisted.refreshToken == "refresh-2")
        #expect(persisted.accessExpiresAt == clock.now.addingTimeInterval(1_209_600))
        #expect(persisted.baseURL == server.baseURL)
    }

    @Test("TokenManager：refresh token 失效 → .unauthorized 并清空本地凭据")
    func tokenRefreshInvalidGrantClearsCredentials() async throws {
        let server = APIStubServer()
        server.enqueue(oauthError: "invalid_grant", description: "This refresh token was used.")
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(-1))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        await expectAPIError(.unauthorized) {
            _ = try await manager.currentAccessToken()
        }
        #expect(await store.snapshot() == nil)
        let counters = await store.counters()
        #expect(counters.clear == 1)
    }

    @Test("TokenManager：没有凭据 → .notAuthenticated")
    func tokenManagerWithoutCredentials() async throws {
        let server = APIStubServer()
        let clock = FakeClock(epoch)
        let manager = makeManager(store: InMemoryTokenStore(), server: server, clock: clock)

        await expectAPIError(.notAuthenticated) {
            _ = try await manager.currentAccessToken()
        }
        #expect(server.requestCount == 0)
    }

    @Test("TokenManager：并发取 token 只刷新一次（refresh 轮换不能互相作废）")
    func tokenRefreshIsSingleFlight() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.rotatedTokens)
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(-1))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        async let first = manager.currentAccessToken()
        async let second = manager.currentAccessToken()
        let values = try await (first, second)

        #expect(values.0 == "memos_pat_rotated")
        #expect(values.1 == "memos_pat_rotated")
        #expect(server.requestCount == 1, "并发刷新必须单飞，否则 refresh token 会互相作废")
    }

    @Test("TokenManager.forceRefresh：即使 token 还新鲜也强制轮换（401 后使用）")
    func forceRefreshAlwaysHitsNetwork() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.rotatedTokens)
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(3600))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        let refreshed = try await manager.forceRefresh()
        #expect(refreshed.accessToken == "memos_pat_rotated")
        #expect(server.requestCount == 1)
    }

    @Test("TokenManager：刷新网络失败 → .transport，且不误删凭据（还能重试）")
    func tokenRefreshNetworkFailureKeepsCredentials() async throws {
        let server = APIStubServer()
        server.enqueue(failure: .networkConnectionLost)
        let clock = FakeClock(epoch)
        let credentials = makeCredentials(
            baseURL: server.baseURL, expiresAt: clock.now.addingTimeInterval(-1))
        let store = InMemoryTokenStore(credentials)
        let manager = makeManager(store: store, server: server, clock: clock)

        do {
            _ = try await manager.currentAccessToken()
            Issue.record("应当抛 .transport")
        } catch let error as FlareMoAPIError {
            guard case .transport = error else {
                Issue.record("错误不匹配：\(error)")
                return
            }
        } catch {
            Issue.record("抛错类型不对：\(error)")
        }
        // 网络失败不是 refresh token 失效：凭据保留，下一轮还能重试。
        #expect(await store.snapshot() != nil)
        let counters = await store.counters()
        #expect(counters.clear == 0)
    }
}
