import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：`FlareMoAPIClient` 门面的单测 ——
/// 实例地址归一化、`health()` 的 Bearer/解码/错误映射（含 401 后强制刷新一次）、
/// 匿名 `instance()` 的能力发现与 404 降级、配对收尾（savePairing / signOut）、
/// 以及 token 闭包与 `SyncHTTPConfiguration` 的接线。
@Suite("连接实例门面")
struct APIClientTests {

    private let epoch = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeClient(
        server: APIStubServer,
        clock: FakeClock,
        store: InMemoryTokenStore
    ) -> FlareMoAPIClient {
        let manager = TokenManager(
            store: store,
            session: server.makeSession(),
            refreshLeeway: 60,
            now: { clock.now })
        return FlareMoAPIClient(
            baseURL: server.baseURL,
            session: server.makeSession(),
            tokenManager: manager)
    }

    private func freshCredentials(baseURL: URL, clock: FakeClock) -> StoredCredentials {
        StoredCredentials(
            baseURL: baseURL,
            accessToken: "memos_pat_live",
            refreshToken: "refresh-1",
            accessExpiresAt: clock.now.addingTimeInterval(3600),
            scope: "notes",
            clientName: "FlareMo macOS")
    }

    // MARK: 实例地址

    @Test("normalizeBaseURL：去空白 / 小写 host / 去尾斜杠 / 保留端口与路径")
    func normalizeBaseURL() throws {
        let cases: [(String, String)] = [
            (" https://KOSX.Example.com/ ", "https://kosx.example.com"),
            ("https://kosx.example.com", "https://kosx.example.com"),
            ("http://127.0.0.1:8787", "http://127.0.0.1:8787"),
            ("https://kosx.example.com/sub/", "https://kosx.example.com/sub"),
        ]
        for (input, expected) in cases {
            let url = try FlareMoAPIClient.normalizeBaseURL(input)
            #expect(url.absoluteString == expected, "\(input) → \(url.absoluteString)")
        }
    }

    @Test("normalizeBaseURL：非法输入抛 .invalidBaseURL")
    func normalizeBaseURLRejectsInvalid() {
        let invalidInputs = [
            "",
            "   ",
            "example.com",
            "ftp://kosx.example.com",
            "https://",
            "https://user:pass@kosx.example.com",
            "https://kosx.example.com?query=1",
        ]
        for input in invalidInputs {
            do {
                _ = try FlareMoAPIClient.normalizeBaseURL(input)
                Issue.record("应当拒绝：\(input)")
            } catch let error as FlareMoAPIError {
                #expect(error == .invalidBaseURL(input))
            } catch {
                Issue.record("抛错类型不对：\(error)")
            }
        }
    }

    // MARK: health()

    @Test("health：带 Bearer、解码真实响应形状（snake_case → camelCase）")
    func healthDecodesAndAuthorizes() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.health)
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore(freshCredentials(baseURL: server.baseURL, clock: clock))
        let client = makeClient(server: server, clock: clock, store: store)

        let health = try await client.health()

        #expect(health.ok)
        #expect(health.product == "FlareMo")
        #expect(health.version == "0.31.1")
        #expect(health.updateRepository == "chendahuang/flaremo")
        #expect(health.teamLayout == "team")
        #expect(health.emailProvider == "none")
        #expect(
            health.updateWorkflowUrl
                == "https://github.com/chendahuang/flaremo/actions/workflows/flaremo-update.yml")

        let request = try #require(server.requests.first)
        #expect(request.method == "GET")
        #expect(request.path == "/api/app/health")
        #expect(request.header("Authorization") == "Bearer memos_pat_live")
        #expect(request.header("Accept") == "application/json")
    }

    @Test("health：服务端 5xx 映射成 .server(status,message)，错误信封被解析")
    func healthServerError() async throws {
        let server = APIStubServer()
        server.enqueue(appError: "boom", status: 500)
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore(freshCredentials(baseURL: server.baseURL, clock: clock))
        let client = makeClient(server: server, clock: clock, store: store)

        await expectAPIError(.server(status: 500, message: "boom")) {
            _ = try await client.health()
        }
    }

    @Test("health：401 后强制刷新一次；refresh 也失效 → .unauthorized 且清凭据")
    func healthUnauthorizedTriggersRefreshThenFails() async throws {
        let server = APIStubServer()
        // 第一次 health 401；随后强制刷新返回 refresh token 失效。
        server.enqueue(appError: "Unauthorized", status: 401)
        server.enqueue(oauthError: "expired_token", description: "The refresh token expired.")
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore(freshCredentials(baseURL: server.baseURL, clock: clock))
        let client = makeClient(server: server, clock: clock, store: store)

        await expectAPIError(.unauthorized) {
            _ = try await client.health()
        }

        let requests = server.requests
        #expect(requests.count == 2)
        #expect(requests.first?.path == "/api/app/health")
        #expect(requests.last?.path == "/connect/token")
        #expect(await store.snapshot() == nil)
    }

    @Test("health：401 后退避刷新成功，重试一次通过")
    func healthRetriesAfterSuccessfulRefresh() async throws {
        let server = APIStubServer()
        server.enqueue(appError: "token revoked", status: 401)
        server.enqueue(json: APIFixtures.rotatedTokens)
        server.enqueue(json: APIFixtures.health)
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore(freshCredentials(baseURL: server.baseURL, clock: clock))
        let client = makeClient(server: server, clock: clock, store: store)

        let health = try await client.health()
        #expect(health.ok)
        #expect(server.requestCount == 3)
        // 重试用的是轮换后的新 token。
        let retried = try #require(server.requests.last)
        #expect(retried.header("Authorization") == "Bearer memos_pat_rotated")
    }

    // MARK: instance()

    @Test("instance：匿名请求、解码 InstanceCapabilities（能力是带版本号的对象）")
    func instanceDecodesCapabilities() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.instance)
        let clock = FakeClock(epoch)
        let client = makeClient(server: server, clock: clock, store: InMemoryTokenStore())

        let capabilities = try await client.instance()

        #expect(capabilities.version == "0.31.1")
        #expect(capabilities.supports("sync_changes"))
        #expect(capabilities.version(of: "sync_changes") == 1)
        // 服务端明确写 0 / 空数组：客户端要降级，不能以为有乐观锁或推送。
        #expect(capabilities.version(of: "optimistic_lock") == 0)
        #expect(!capabilities.supports("does_not_exist"))

        let request = try #require(server.requests.first)
        #expect(request.path == "/api/app/instance")
        #expect(
            request.header("Authorization") == nil,
            "能力发现是匿名端点，不应带凭据")
    }

    @Test("instance：旧实例 404 → .notFound（调用方据此降级）")
    func instanceNotFound() async throws {
        let server = APIStubServer()
        server.enqueue(appError: "Not Found", status: 404)
        let clock = FakeClock(epoch)
        let client = makeClient(server: server, clock: clock, store: InMemoryTokenStore())

        await expectAPIError(.notFound) {
            _ = try await client.instance()
        }
    }

    // MARK: 配对收尾 / token 闭包

    @Test("savePairing：把 baseURL + 过期时间 + 轮换凭据落库；signOut 清空")
    func savePairingAndSignOut() async throws {
        let server = APIStubServer()
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore()
        let client = makeClient(server: server, clock: clock, store: store)

        let tokens = IssuedTokens(
            accessToken: "memos_pat_live",
            expiresIn: 1_209_600,
            refreshToken: "refresh-1",
            scope: "notes")
        let saved = try await client.savePairing(
            tokens, clientName: "FlareMo macOS", now: clock.now)

        #expect(saved.baseURL == server.baseURL)
        #expect(saved.accessToken == "memos_pat_live")
        #expect(saved.refreshToken == "refresh-1")
        #expect(saved.accessExpiresAt == clock.now.addingTimeInterval(1_209_600))
        #expect(saved.scope == "notes")
        #expect(saved.clientName == "FlareMo macOS")

        let persisted = try #require(try await client.credentials())
        #expect(persisted == saved)
        #expect(try await client.currentAccessToken() == "memos_pat_live")

        try await client.signOut()
        #expect(try await client.credentials() == nil)
        await expectAPIError(.notAuthenticated) {
            _ = try await client.currentAccessToken()
        }
    }

    @Test("token 闭包可直接喂给 SyncHTTPConfiguration.accessToken")
    func tokenProviderPlugsIntoSyncConfiguration() async throws {
        let server = APIStubServer()
        let clock = FakeClock(epoch)
        let store = InMemoryTokenStore(freshCredentials(baseURL: server.baseURL, clock: clock))
        let client = makeClient(server: server, clock: clock, store: store)

        let configuration = SyncHTTPConfiguration(
            baseURL: client.baseURL,
            accessToken: client.accessTokenProvider(),
            session: server.makeSession())

        let token = try await configuration.accessToken()
        #expect(token == "memos_pat_live")
        #expect(server.requestCount == 0, "token 还新鲜时不应发网络请求")
    }
}
