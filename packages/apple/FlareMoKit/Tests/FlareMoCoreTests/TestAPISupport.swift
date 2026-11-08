import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：API 层单测的公共夹具 ——
/// 1. `URLProtocol` 桩（每个测试用唯一 host 路由，测试可并行跑）；
/// 2. 假时钟 + 可注入 sleep 的记录器（设备授权轮询不真的等 5 秒）；
/// 3. 内存版 `TokenStoring`（**绝不碰真钥匙串**）；
/// 4. 后端真实响应形状的 JSON 夹具。

// MARK: - URLProtocol 桩

/// 一次桩响应。
struct StubResponse: Sendable {
    var status: Int
    var headers: [String: String]
    var body: Data

    static func json(_ json: String, status: Int = 200) -> StubResponse {
        StubResponse(
            status: status,
            headers: ["Content-Type": "application/json"],
            body: Data(json.utf8))
    }

    /// OAuth 风格错误信封（`/connect/token` 的 400/429）。
    static func oauthError(
        _ code: String, description: String? = nil, status: Int = 400
    ) -> StubResponse {
        var body: [String: String] = ["error": code]
        if let description { body["error_description"] = description }
        let data = try! JSONSerialization.data(withJSONObject: body)
        return StubResponse(
            status: status, headers: ["Content-Type": "application/json"], body: data)
    }

    /// 应用风格错误信封（`jsonError`：`{"error":{"message":"..."}}`）。
    static func appError(_ message: String, status: Int) -> StubResponse {
        let data = try! JSONSerialization.data(withJSONObject: ["error": ["message": message]])
        return StubResponse(
            status: status, headers: ["Content-Type": "application/json"], body: data)
    }
}

/// 桩队列里的一项：正常响应或传输层失败。
enum StubStep: Sendable {
    case response(StubResponse)
    case failure(URLError.Code)
}

/// 每个测试一个实例：用唯一 host 注册路由，避免并行测试互相抢 handler。
final class APIStubServer: @unchecked Sendable {
    let host: String
    let baseURL: URL

    private let lock = NSLock()
    private var steps: [StubStep] = []
    private var recorded: [StubRequest] = []

    init() {
        let host = "stub-\(UUID().uuidString.lowercased()).test"
        self.host = host
        self.baseURL = URL(string: "https://\(host)")!
        StubRegistry.shared.register(host: host) { [weak self] request in
            guard let self else { throw URLError(.unknown) }
            return try self.handle(request)
        }
    }

    // MARK: 排期响应

    func enqueue(_ response: StubResponse) {
        lock.lock()
        steps.append(.response(response))
        lock.unlock()
    }

    func enqueue(json: String, status: Int = 200) {
        enqueue(.json(json, status: status))
    }

    func enqueue(oauthError code: String, description: String? = nil, status: Int = 400) {
        enqueue(.oauthError(code, description: description, status: status))
    }

    func enqueue(appError message: String, status: Int = 400) {
        enqueue(.appError(message, status: status))
    }

    func enqueue(failure code: URLError.Code) {
        lock.lock()
        steps.append(.failure(code))
        lock.unlock()
    }

    // MARK: 记录

    var requests: [StubRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    var requestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return recorded.count
    }

    // MARK: 内部

    private func handle(_ request: URLRequest) throws -> StubResponse {
        let record = StubRequest(
            method: request.httpMethod ?? "GET",
            url: request.url,
            headers: request.allHTTPHeaderFields ?? [:],
            body: Self.extractBody(request))
        lock.lock()
        recorded.append(record)
        let next = steps.isEmpty ? StubStep.response(.json("{}", status: 500)) : steps.removeFirst()
        lock.unlock()
        switch next {
        case .response(let response):
            return response
        case .failure(let code):
            throw URLError(code)
        }
    }

    /// URLSession 给 URLProtocol 的请求通常把 body 放在 `httpBodyStream` 里。
    private static func extractBody(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4096
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(contentsOf: buffer[0..<read])
        }
        return data
    }
}

/// 测试用 URLSession：只装桩、不碰网络。
extension APIStubServer {
    func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

/// 全局 host → handler 注册表（锁保护，测试并行安全）。
private final class StubRegistry: @unchecked Sendable {
    static let shared = StubRegistry()

    private let lock = NSLock()
    private var handlers: [String: @Sendable (URLRequest) throws -> StubResponse] = [:]

    func register(host: String, handler: @escaping @Sendable (URLRequest) throws -> StubResponse) {
        lock.lock()
        handlers[host] = handler
        lock.unlock()
    }

    func handler(for host: String) -> (@Sendable (URLRequest) throws -> StubResponse)? {
        lock.lock()
        defer { lock.unlock() }
        return handlers[host]
    }
}

/// 真正拦截 URLSession 的 URLProtocol 实现。
final class StubURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
            let host = url.host,
            let handler = StubRegistry.shared.handler(for: host)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        do {
            let stub = try handler(request)
            guard
                let response = HTTPURLResponse(
                    url: url, statusCode: stub.status, httpVersion: "HTTP/1.1",
                    headerFields: stub.headers)
            else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if !stub.body.isEmpty {
                client?.urlProtocol(self, didLoad: stub.body)
            }
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

// MARK: - 假时钟 / sleep 记录

final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_700_000_000)) {
        self.current = start
    }

    var now: Date {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func advance(seconds: Double) {
        lock.lock()
        current = current.addingTimeInterval(seconds)
        lock.unlock()
    }
}

final class SleepRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Duration] = []

    func record(_ duration: Duration) {
        lock.lock()
        recorded.append(duration)
        lock.unlock()
    }

    var durations: [Duration] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    var seconds: [Double] {
        durations.map { duration in
            Double(duration.components.seconds)
                + Double(duration.components.attoseconds) / 1_000_000_000_000_000_000
        }
    }

    /// 给 `DeviceAuthorizationClient.sleep` 用的注入闭包：记录 + 推进假时钟。
    func sleeper(clock: FakeClock) -> @Sendable (Duration) async throws -> Void {
        { duration in
            self.record(duration)
            clock.advance(seconds: Double(duration.components.seconds))
        }
    }
}

// MARK: - 内存 TokenStore

/// 测试用凭据存储：不碰钥匙串。
actor InMemoryTokenStore: TokenStoring {
    private var stored: StoredCredentials?
    private var saveCount = 0
    private var clearCount = 0

    init(_ credentials: StoredCredentials? = nil) {
        self.stored = credentials
    }

    func load() async throws -> StoredCredentials? { stored }

    func save(_ credentials: StoredCredentials) async throws {
        stored = credentials
        saveCount += 1
    }

    func clear() async throws {
        stored = nil
        clearCount += 1
    }

    func snapshot() -> StoredCredentials? { stored }

    func counters() -> (save: Int, clear: Int) { (saveCount, clearCount) }
}

// MARK: - 记录下来的请求

/// `/connect/token` 等请求的 HTTP body 在 URLProtocol 里可能是 `httpBodyStream`
/// 而不是 `httpBody`（URLSession 会把 body 转成流）。这里在 handler 里当场把 body
/// 读出来，测试断言的是「实际发出去的字节」。
struct StubRequest: Sendable {
    var method: String
    var url: URL?
    var headers: [String: String]
    var body: Data

    var path: String { url?.path ?? "" }

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }

    var bodyString: String { String(decoding: body, as: UTF8.self) }
}

// MARK: - 后端真实形状的夹具

enum APIFixtures {
    /// `POST /connect/device` 的真实响应形状（`connect-api.ts`）。
    static let deviceAuthorization = """
        {
          "device_code": "device-code-1",
          "user_code": "ABCD2345",
          "verification_uri": "https://kosx.example.com/connect",
          "verification_uri_complete": "https://kosx.example.com/connect?code=ABCD2345",
          "expires_in": 300,
          "interval": 5
        }
        """

    /// `POST /connect/token` 的成功响应（access 14 天 = 1_209_600 秒）。
    static let issuedTokens = """
        {
          "access_token": "memos_pat_live",
          "token_type": "Bearer",
          "expires_in": 1209600,
          "refresh_token": "refresh-1",
          "scope": "notes"
        }
        """

    /// 轮换后的第二次 token 响应。
    static let rotatedTokens = """
        {
          "access_token": "memos_pat_rotated",
          "token_type": "Bearer",
          "expires_in": 1209600,
          "refresh_token": "refresh-2",
          "scope": "notes"
        }
        """

    /// `GET /api/app/health` 的真实响应形状（`apps/worker/src/routes/app/me.ts`）。
    static let health = """
        {
          "ok": true,
          "product": "FlareMo",
          "version": "0.31.1",
          "update_repository": "chendahuang/flaremo",
          "update_workflow_url": "https://github.com/chendahuang/flaremo/actions/workflows/flaremo-update.yml",
          "releases_url": "https://github.com/chendahuang/flaremo/releases",
          "update_guide_url": "https://flaremo.example.com/update",
          "team_layout": "team",
          "email_provider": "none"
        }
        """

    /// `GET /api/app/instance` 的真实响应形状（`routes/app/instance.ts`）。
    static let instance = """
        {
          "version": "0.31.1",
          "api_versions": ["app-v1"],
          "capabilities": {
            "sync_changes": 1,
            "sync_hydrate": 1,
            "soft_delete_tombstone": 1,
            "optimistic_lock": 0,
            "native_push": [],
            "direct_upload": 0,
            "pat_grant": 0
          }
        }
        """
}

// MARK: - 错误断言辅助

func expectDeviceAuthorizationError(
    _ expected: DeviceAuthorizationError,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("应当抛错，但成功返回了", sourceLocation: sourceLocation)
    } catch let error as DeviceAuthorizationError {
        #expect(error == expected, "错误不匹配：\(error)", sourceLocation: sourceLocation)
    } catch {
        Issue.record("抛错类型不对：\(error)", sourceLocation: sourceLocation)
    }
}

func expectDeviceNetworkError(
    sourceLocation: SourceLocation = #_sourceLocation,
    _ operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("应当抛网络错误，但成功返回了", sourceLocation: sourceLocation)
    } catch let error as DeviceAuthorizationError {
        guard case .network(let message) = error else {
            Issue.record("应当抛 .network，实际：\(error)", sourceLocation: sourceLocation)
            return
        }
        #expect(!message.isEmpty, "网络错误信息不应为空", sourceLocation: sourceLocation)
    } catch {
        Issue.record("抛错类型不对：\(error)", sourceLocation: sourceLocation)
    }
}

func expectAPIError(
    _ expected: FlareMoAPIError,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("应当抛错，但成功返回了", sourceLocation: sourceLocation)
    } catch let error as FlareMoAPIError {
        #expect(error == expected, "错误不匹配：\(error)", sourceLocation: sourceLocation)
    } catch {
        Issue.record("抛错类型不对：\(error)", sourceLocation: sourceLocation)
    }
}
