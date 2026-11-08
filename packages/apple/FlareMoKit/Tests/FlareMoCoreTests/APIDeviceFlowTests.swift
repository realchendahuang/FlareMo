import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：`DeviceAuthorizationClient` 的单测 ——
/// 配对码申请（请求构造 + 响应解码）、RFC 8628 轮询状态机
/// （pending → ok、slow_down 加间隔、expired/denied 终止、本地超时、网络失败）、
/// refresh token 续期。
///
/// 轮询的等待全部走注入的 `sleep`（记录 + 推进假时钟），单测不会真的等 5 秒。
@Suite("设备授权（配对码）")
struct APIDeviceFlowTests {

    // MARK: 夹具

    private func makeClient(
        _ server: APIStubServer,
        clock: FakeClock,
        recorder: SleepRecorder
    ) -> DeviceAuthorizationClient {
        DeviceAuthorizationClient(
            baseURL: server.baseURL,
            session: server.makeSession(),
            sleep: recorder.sleeper(clock: clock),
            now: { clock.now })
    }

    private func makeAuthorization(
        clock: FakeClock, expiresIn: Int = 300, interval: Int = 5
    ) -> DeviceAuthorization {
        DeviceAuthorization(
            deviceCode: "device-code-1",
            userCode: "ABCD2345",
            verificationURI: URL(string: "https://kosx.example.com/connect")!,
            verificationURIComplete: nil,
            expiresIn: expiresIn,
            interval: interval,
            receivedAt: clock.now)
    }

    // MARK: start()

    @Test("start：请求体 client_name / client_type / scopes，响应归一化")
    func startBuildsRequestAndDecodesResponse() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.deviceAuthorization)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        let authorization = try await client.start(
            clientName: "FlareMo macOS", scopes: ["notes"])

        #expect(authorization.deviceCode == "device-code-1")
        #expect(authorization.userCode == "ABCD2345")
        #expect(authorization.verificationURI.absoluteString == "https://kosx.example.com/connect")
        #expect(
            authorization.verificationURIComplete.absoluteString
                == "https://kosx.example.com/connect?code=ABCD2345")
        #expect(authorization.expiresIn == 300)
        #expect(authorization.interval == 5)
        #expect(authorization.receivedAt == clock.now)

        let request = try #require(server.requests.first)
        #expect(request.method == "POST")
        #expect(request.path == "/connect/device")
        #expect(request.header("Content-Type") == "application/json")

        let object = try JSONSerialization.jsonObject(with: request.body)
        let json = try #require(object as? [String: Any])
        #expect(json["client_name"] as? String == "FlareMo macOS")
        // 服务端 APP_CLIENT_TYPES 只有 device/web/script（不是文档契约里的 mac）。
        #expect(json["client_type"] as? String == "device")
        #expect(json["scopes"] as? [String] == ["notes"])
    }

    @Test("start：旧实例缺 verification_uri_complete 时回落到 verification_uri")
    func startFallsBackWhenCompleteURIMissing() async throws {
        let server = APIStubServer()
        server.enqueue(
            json: """
                {"device_code":"d1","user_code":"CODE1234",
                 "verification_uri":"http://127.0.0.1:8787/connect",
                 "expires_in":0,"interval":0}
                """)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        let authorization = try await client.start(clientName: "测试")
        #expect(
            authorization.verificationURIComplete.absoluteString
                == "http://127.0.0.1:8787/connect")
        // 缺省/非法值要归一：expires_in → 300，interval → 5（且夹在 1...60）。
        #expect(authorization.expiresIn == 300)
        #expect(authorization.interval == 5)
    }

    @Test("start：429 限流映射成 .network")
    func startRateLimited() async throws {
        let server = APIStubServer()
        server.enqueue(
            .oauthError(
                "slow_down", description: "Too many pairing requests. Try again shortly.",
                status: 429))
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        await expectDeviceNetworkError {
            _ = try await client.start(clientName: "FlareMo macOS")
        }
        #expect(server.requestCount == 1)
    }

    // MARK: poll() 状态机

    @Test("poll：authorization_pending 继续，拿到 token 返回；首次请求立即发出")
    func pollPendingThenIssued() async throws {
        let server = APIStubServer()
        server.enqueue(oauthError: "authorization_pending")
        server.enqueue(oauthError: "authorization_pending")
        server.enqueue(json: APIFixtures.issuedTokens)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)
        let authorization = makeAuthorization(clock: clock)

        let tokens = try await client.poll(authorization)

        #expect(tokens.accessToken == "memos_pat_live")
        #expect(tokens.refreshToken == "refresh-1")
        #expect(tokens.expiresIn == 1_209_600)
        #expect(tokens.scope == "notes")
        // 两次 pending → 各等一个 interval（5 秒）。
        #expect(recorder.seconds == [5, 5])
        #expect(server.requestCount == 3)
        // 首次请求是立即发出的，所以假时钟只前进了 10 秒。
        #expect(clock.now == authorization.receivedAt.addingTimeInterval(10))
    }

    @Test("poll：轮询请求是 form-urlencoded，带 device grant_type")
    func pollUsesFormEncoding() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.issuedTokens)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        _ = try await client.poll(makeAuthorization(clock: clock))

        let request = try #require(server.requests.first)
        #expect(request.path == "/connect/token")
        #expect(
            request.header("Content-Type")
                == "application/x-www-form-urlencoded")
        #expect(
            request.bodyString
                == "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=device-code-1")
    }

    @Test("poll：slow_down 把间隔 +5 秒（400 与 429 都认）")
    func pollSlowDownIncreasesInterval() async throws {
        let server = APIStubServer()
        server.enqueue(oauthError: "authorization_pending")
        server.enqueue(oauthError: "slow_down", status: 400)
        server.enqueue(oauthError: "slow_down", status: 429)
        server.enqueue(json: APIFixtures.issuedTokens)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        let tokens = try await client.poll(makeAuthorization(clock: clock))

        #expect(tokens.accessToken == "memos_pat_live")
        // pending → 5；slow_down → 10；slow_down → 15。
        #expect(recorder.seconds == [5, 10, 15])
        #expect(server.requestCount == 4)
    }

    @Test("poll：access_denied 终止为 .denied（不再重试）")
    func pollDenied() async throws {
        let server = APIStubServer()
        server.enqueue(oauthError: "access_denied", description: "User denied the request.")
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        await expectDeviceAuthorizationError(.denied) {
            _ = try await client.poll(makeAuthorization(clock: clock))
        }
        #expect(server.requestCount == 1)
        #expect(recorder.seconds.isEmpty)
    }

    @Test("poll：expired_token / invalid_grant 都终止为 .expired")
    func pollExpired() async throws {
        for code in ["expired_token", "invalid_grant"] {
            let server = APIStubServer()
            server.enqueue(oauthError: code)
            let clock = FakeClock()
            let recorder = SleepRecorder()
            let client = makeClient(server, clock: clock, recorder: recorder)

            await expectDeviceAuthorizationError(.expired) {
                _ = try await client.poll(makeAuthorization(clock: clock))
            }
            #expect(server.requestCount == 1, "\(code) 应立即终止")
        }
    }

    @Test("poll：一直 pending 超过 expires_in → .timedOut")
    func pollTimesOut() async throws {
        let server = APIStubServer()
        for _ in 0..<10 {
            server.enqueue(oauthError: "authorization_pending")
        }
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)
        // 有效期 12 秒、间隔 5 秒：t=0/5/10 各一次 pending，t=15 判定超时。
        let authorization = makeAuthorization(clock: clock, expiresIn: 12, interval: 5)

        await expectDeviceAuthorizationError(.timedOut) {
            _ = try await client.poll(authorization)
        }
        #expect(server.requestCount == 3)
        #expect(recorder.seconds == [5, 5, 5])
    }

    @Test("poll：服务端 5xx / 坏 JSON / 连接失败都终止为 .network")
    func pollNetworkFailures() async throws {
        let clock = FakeClock()

        let serverError = APIStubServer()
        serverError.enqueue(.json(#"{"error":"boom"}"#, status: 500))
        let recorder1 = SleepRecorder()
        await expectDeviceNetworkError {
            _ = try await makeClient(serverError, clock: clock, recorder: recorder1)
                .poll(makeAuthorization(clock: clock))
        }

        let badJSON = APIStubServer()
        badJSON.enqueue(json: "not json")
        let recorder2 = SleepRecorder()
        await expectDeviceNetworkError {
            _ = try await makeClient(badJSON, clock: clock, recorder: recorder2)
                .poll(makeAuthorization(clock: clock))
        }

        let offline = APIStubServer()
        offline.enqueue(failure: .cannotConnectToHost)
        let recorder3 = SleepRecorder()
        await expectDeviceNetworkError {
            _ = try await makeClient(offline, clock: clock, recorder: recorder3)
                .poll(makeAuthorization(clock: clock))
        }
    }

    // MARK: refresh()

    @Test("refresh：form-urlencoded 的 refresh_token grant，返回轮换后的新令牌")
    func refreshRotatesTokens() async throws {
        let server = APIStubServer()
        server.enqueue(json: APIFixtures.rotatedTokens)
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        let tokens = try await client.refresh(refreshToken: "refresh-1")

        #expect(tokens.accessToken == "memos_pat_rotated")
        #expect(tokens.refreshToken == "refresh-2")
        let request = try #require(server.requests.first)
        #expect(request.path == "/connect/token")
        #expect(request.bodyString == "grant_type=refresh_token&refresh_token=refresh-1")
    }

    @Test("refresh：refresh token 过期 → .expired（调用方据此清凭据重新配对）")
    func refreshExpired() async throws {
        let server = APIStubServer()
        server.enqueue(oauthError: "expired_token", description: "The refresh token expired.")
        let clock = FakeClock()
        let recorder = SleepRecorder()
        let client = makeClient(server, clock: clock, recorder: recorder)

        await expectDeviceAuthorizationError(.expired) {
            _ = try await client.refresh(refreshToken: "expired-refresh")
        }
    }
}
