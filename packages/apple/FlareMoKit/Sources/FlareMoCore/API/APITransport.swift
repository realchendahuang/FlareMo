import Foundation

/// 本文件负责：API 层的内部 HTTP 工具 —— JSON 编解码策略、请求发送与错误映射、
/// `application/x-www-form-urlencoded` 编码、服务端错误信封解析。
///
/// 风格与 `Sources/FlareMoCore/Sync/URLSessionSyncTransport.swift` 对齐：
/// - 线格式统一用 `convertFromSnakeCase` / `convertToSnakeCase`，不手写键名映射；
/// - 传输异常统一包成 `.transport`，状态码由调用方按语义映射（401/403 → `.unauthorized`，
///   404 → `.notFound`，其它 → `.server`）。
///
/// 设备授权端点的错误信封有两种形状，`APITransport.errorMessage(from:)` 都认：
/// - OAuth 风格：`{"error":"expired_token","error_description":"..."}`（`/connect/token`）；
/// - 应用风格：`{"error":{"message":"..."}}`（`jsonError`，见 `apps/worker/src/http.ts`）。
enum APITransport {
    // MARK: 编解码

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

    // MARK: 请求

    /// 发一个请求：网络错误 → `.transport`；非 2xx → 按状态码映射；2xx 返回原始 body。
    static func send(
        _ request: URLRequest,
        session: URLSession
    ) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw FlareMoAPIError.transport(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw FlareMoAPIError.transport("非 HTTP 响应")
        }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401, 403:
            throw FlareMoAPIError.unauthorized
        case 404:
            throw FlareMoAPIError.notFound
        default:
            throw FlareMoAPIError.server(
                status: http.statusCode,
                message: errorMessage(from: data))
        }
    }

    /// 解码 2xx 响应；失败时把具体原因带进 `.decoding`（方便定位契约漂移）。
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw FlareMoAPIError.decoding(String(describing: error))
        }
    }

    // MARK: 错误信封

    /// 从错误响应体里取出人类可读信息；两种信封都试一遍。
    static func errorMessage(from data: Data) -> String? {
        // 应用风格：{"error":{"message":"..."}}
        if let wrapper = try? decoder.decode(APIErrorMessageWrapper.self, from: data),
            let message = wrapper.error.message, !message.isEmpty
        {
            return message
        }
        // OAuth 风格：{"error":"code","error_description":"..."}
        if let oauth = try? decoder.decode(OAuthErrorBody.self, from: data) {
            if let description = oauth.errorDescription, !description.isEmpty {
                return description
            }
            return oauth.error
        }
        let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (raw?.isEmpty ?? true) ? nil : raw
    }

    // MARK: form-urlencoded

    /// `application/x-www-form-urlencoded` 编码。
    ///
    /// 只用于 `/connect/token`：服务端同时接受 JSON 和 form（`connect-api.ts` 的
    /// `readTokenBody`），这里按 RFC 6749 的惯例发 form。字段顺序由调用方决定，
    /// 测试直接断言字节，避免「看起来对了」。
    static func formURLEncodedString(_ fields: [(String, String)]) -> String {
        fields
            .map { "\(percentEncode($0.0))=\(percentEncode($0.1))" }
            .joined(separator: "&")
    }

    static func formURLEncoded(_ fields: [(String, String)]) -> Data {
        Data(formURLEncodedString(fields).utf8)
    }

    /// RFC 3986 的 unreserved 之外全部百分号编码（空格 → `%20`）。
    static func percentEncode(_ value: String) -> String {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var bytes: [UInt8] = []
        for byte in Data(value.utf8) {
            if allowed.contains(Unicode.Scalar(byte)) {
                bytes.append(byte)
            } else {
                bytes.append(contentsOf: Array(String(format: "%%%02X", byte).utf8))
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    // MARK: 私有信封类型

    private struct APIErrorMessageWrapper: Decodable {
        struct Inner: Decodable {
            var message: String?
        }
        var error: Inner
    }

    private struct OAuthErrorBody: Decodable {
        var error: String
        var errorDescription: String?
    }
}
