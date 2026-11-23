import Foundation

/// 真实的同步传输层：`URLSession` + `URLRequest`。
///
/// 与 `SyncTransport` 分开的理由：引擎单测用假传输层，这里只测「请求怎么造、响应怎么解」，
/// 不把一个活的实例塞进单测（那会让测试依赖后端是否在跑）。
///
/// 线格式以 `docs/native-clients.md` §4.4 为准，并且和真实后端的响应对齐过
/// （下面的单测夹具就是后端实际吐出来的 JSON）。
public struct SyncHTTPConfiguration: Sendable {
    public var baseURL: URL
    /// 取 access token。401 时由认证层负责刷新后再调一次。
    public var accessToken: @Sendable () async throws -> String
    public var session: URLSession

    public init(
        baseURL: URL,
        accessToken: @escaping @Sendable () async throws -> String,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.session = session
    }
}

public struct URLSessionSyncTransport: SyncTransport {
    private let configuration: SyncHTTPConfiguration

    public init(configuration: SyncHTTPConfiguration) {
        self.configuration = configuration
    }

    // MARK: 拉

    public func fetchChanges(since: Int, limit: Int) async throws -> SyncChangesPage {
        var components = URLComponents(
            url: configuration.baseURL.appendingPathComponent("api/app/sync/changes"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "since", value: String(since)),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let url = components?.url else { throw SyncError.retryable("URL 组合失败") }
        let data = try await send(URLRequest(url: url), method: "GET")
        return try Self.decoder.decode(SyncChangesPage.self, from: data)
    }

    // MARK: 补正文

    public func hydrate(_ request: HydrateRequest) async throws -> HydrateResponse {
        var urlRequest = URLRequest(
            url: configuration.baseURL.appendingPathComponent("api/app/sync/hydrate")
        )
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try Self.encoder.encode(request)
        let data = try await send(urlRequest, method: "POST")
        return try Self.decoder.decode(HydrateResponse.self, from: data)
    }

    // MARK: 推

    /// 上送走的是既有 REST 端点（§4.4 表里没有批量的 `/sync/push`）：
    /// create → `POST /api/app/memos`，update/delete → `PATCH /api/app/memos/:id`。
    ///
    /// 逐条发而不是批量，是服务端的现状；等它有批量端点再换，引擎侧的接口不变。
    public func push(_ request: PushRequest) async throws -> PushResponse {
        var results: [PushResult] = []
        for operation in request.operations {
            let result = try await pushOne(operation)
            results.append(result)
        }
        return PushResponse(results: results)
    }

    private func pushOne(_ operation: PushOperation) async throws -> PushResult {
        let memoPath = "api/app/memos"
        var urlRequest: URLRequest
        switch operation.op {
        case "create":
            urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent(memoPath))
            urlRequest.httpMethod = "POST"
            urlRequest.httpBody = try Self.encoder.encode(operation.payload)
        case "update", "delete":
            urlRequest = URLRequest(
                url: configuration.baseURL.appendingPathComponent("\(memoPath)/\(operation.entityId)")
            )
            urlRequest.httpMethod = "PATCH"
            var body = operation.payload
            if let expected = operation.expectedVersion {
                // 服务端能力位 `optimistic_lock` 为 0 时忽略这个字段（§4.6），不会报错。
                body["expected_version"] = .int(expected)
            }
            if operation.op == "delete" {
                body["status"] = .string("trashed")
            }
            urlRequest.httpBody = try Self.encoder.encode(body)
        default:
            return PushResult(
                idempotencyKey: operation.idempotencyKey,
                status: "error",
                version: nil,
                message: "不支持的操作：\(operation.op)",
                serverMemo: nil
            )
        }
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let data = try await send(urlRequest, method: urlRequest.httpMethod ?? "POST")
            let memo = try? Self.decoder.decode(RemoteMemo.self, from: data)
            return PushResult(
                idempotencyKey: operation.idempotencyKey,
                status: "applied",
                version: memo?.version,
                message: nil,
                serverMemo: memo
            )
        } catch SyncError.unauthorized {
            throw SyncError.unauthorized
        } catch let SyncHTTPFailure.status(code, data) where code == 409 {
            // 冲突：服务端带回最新正文时用它覆盖本地（LWW）。
            let memo = try? Self.decoder.decode(RemoteMemo.self, from: data)
            return PushResult(
                idempotencyKey: operation.idempotencyKey,
                status: "conflict",
                version: memo?.version,
                message: nil,
                serverMemo: memo
            )
        } catch {
            return PushResult(
                idempotencyKey: operation.idempotencyKey,
                status: "error",
                version: nil,
                message: String(describing: error),
                serverMemo: nil
            )
        }
    }

    // MARK: 公共

    private func send(_ request: URLRequest, method: String) async throws -> Data {
        var request = request
        let token = try await configuration.accessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await configuration.session.data(for: request)
        } catch {
            throw SyncError.retryable(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.retryable("非 HTTP 响应")
        }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401, 403:
            throw SyncError.unauthorized
        case 410:
            throw SyncError.cursorExpired
        case 409:
            throw SyncHTTPFailure.status(409, data)
        default:
            throw SyncError.retryable("HTTP \(http.statusCode)")
        }
    }

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }
}

/// 需要把响应体带出去的内部错误（409 冲突时服务端会回最新正文）。
enum SyncHTTPFailure: Error {
    case status(Int, Data)
}
