import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：数据库相关单测的公共夹具（临时目录建库、固定时间戳）。
enum TestDatabase {
    /// 生成一个唯一临时库路径（不建库）。
    static func makePath() -> String {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("FlareMoCoreTests-\(UUID().uuidString)", isDirectory: true)
        return directory.appendingPathComponent("library.sqlite").path
    }

    /// 建一个全新的本地库（临时目录 + WAL 文件）。
    static func make() throws -> AppDatabase {
        let path = makePath()
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        return try AppDatabase.open(atPath: path)
    }

    /// 关闭连接并删掉临时目录（WAL/SHM 一并删掉）。
    static func destroy(_ database: AppDatabase) {
        let url = URL(fileURLWithPath: database.path)
        try? database.close()
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

/// 测试用的固定时间戳（避免依赖真实时钟、保证断言确定）。
enum TestTime {
    static func timestamp(_ string: String) -> ISOTimestamp {
        guard let timestamp = ISOTimestamp(validating: string) else {
            fatalError("测试时间戳非法: \(string)")
        }
        return timestamp
    }

    /// 2026-11-08T10:00:00.000Z
    static let t0 = timestamp("2026-11-08T10:00:00.000Z")
    /// 2026-11-08T10:00:01.000Z
    static let t1 = timestamp("2026-11-08T10:00:01.000Z")
    /// 2026-11-08T10:00:02.000Z
    static let t2 = timestamp("2026-11-08T10:00:02.000Z")
    /// 2026-11-08T10:00:03.000Z
    static let t3 = timestamp("2026-11-08T10:00:03.000Z")
    /// 2026-11-08T10:00:04.000Z
    static let t4 = timestamp("2026-11-08T10:00:04.000Z")
}
