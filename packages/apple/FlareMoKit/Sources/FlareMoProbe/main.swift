import FlareMoCore
import Foundation

/// 联调探针：命令行走一遍「设备配对 → 一轮同步」，用来验证客户端 ↔ 实例这条链。
///
/// 不放进 App 包，也不参与发布；它存在的理由是：
/// 同步链路的失败往往发生在「配对成功但同步 401」「HTTP 通了但落库解不出来」这类接缝上，
/// 单测覆盖不到，只有真打一遍实例才知道。
///
/// 用法：`swift run flaremo-probe http://127.0.0.1:8787`
// main.swift 里只有顶层代码才是入口：定义 @main 类型不会被调用（会静默退出）。
// 顶层 await 在 main.swift 里是允许的，所以这里直接 await。
// 输出重定向到文件时 stdout 是全缓冲，配对码会迟迟不出现——关掉缓冲。
setvbuf(stdout, nil, _IONBF, 0)
let probeExitCode = await Probe.run()
exit(probeExitCode)

@MainActor
struct Probe {
    static func run() async -> Int32 {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2, let baseURL = URL(string: arguments[1]) else {
            print("用法：flaremo-probe <instance-url>")
            return 2
        }

        let store = InMemoryTokenStore()
        do {
            let client = FlareMoAPIClient(baseURL: baseURL, credentialStore: store)

            print("▸ 探测实例 \(baseURL.absoluteString)")
            let instance = try await client.instance()
            print("  版本 \(instance.version ?? "?") · capabilities: \(instance.capabilities.keys.sorted().joined(separator: ", "))")

            print("▸ 申请配对码")
            let deviceClient = DeviceAuthorizationClient(baseURL: baseURL)
            let authorization = try await deviceClient.start(
                clientName: "FlareMo probe",
                clientType: .device,
                scopes: ["notes"]
            )
            print("PROBE_USER_CODE=\(authorization.userCode)")
            print("  打开 \(authorization.verificationURIComplete.absoluteString) 确认")

            print("▸ 等待浏览器确认…")
            let tokens = try await deviceClient.poll(authorization)
            print("  拿到 access token：\(tokens.accessToken.prefix(14))…")
            try await client.savePairing(tokens, clientName: "FlareMo probe")

            print("▸ 建一个临时本地库，跑一轮同步")
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("flaremo-probe-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let database = try AppDatabase.open(inDirectory: directory)
            defer {
                try? database.close()
                try? FileManager.default.removeItem(at: directory)
            }

            let transport = URLSessionSyncTransport(
                configuration: SyncHTTPConfiguration(
                    baseURL: baseURL,
                    accessToken: client.accessTokenProvider()
                )
            )
            let engine = SyncEngine(database: database, transport: transport)
            let summary = await engine.runOnce()

            print("SYNC_PULL_APPLIED=\(summary.pull?.applied ?? -1)")
            print("SYNC_NEXT_SINCE=\(summary.pull?.nextSince ?? -1)")
            if let error = summary.pullError { print("SYNC_PULL_ERROR=\(error)") }
            if let error = summary.pushError { print("SYNC_PUSH_ERROR=\(error)") }

            let page = try MemoStore(database: database, userId: "probe").list(limit: 5)
            print("LOCAL_MEMOS=\(page.memos.count)")
            for memo in page.memos.prefix(3) {
                print("  · \(memo.id)  \(memo.content.prefix(40))")
            }
            print("PROBE_OK")
            return 0
        } catch {
            print("PROBE_FAILED=\(error)")
            return 1
        }
    }
}

/// 探针用的内存凭据存储（不碰真钥匙串）。
final class InMemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var value: StoredCredentials?

    func load() async throws -> StoredCredentials? {
        lock.withLock { value }
    }

    func save(_ credentials: StoredCredentials) async throws {
        lock.withLock { value = credentials }
    }

    func clear() async throws {
        lock.withLock { value = nil }
    }
}
