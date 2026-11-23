import Foundation
import Synchronization

/// 本文件负责：客户端主键生成 —— UUIDv7（RFC 9562）。
///
/// 为什么是 UUIDv7（见 docs/native-clients.md §7.7「三个全局约定」第 1 条）：
/// 新建实体一律由客户端生成 ID，服务端接受客户端 ID 做幂等。UUIDv7 的前 48 位是
/// Unix 毫秒时间戳，因此**字符串序 = 时间序**，对 SQLite 的 text 主键与
/// `(created_at, id)` 兜底排序都索引友好；这一点是 UUIDv4 不具备的。
///
/// 同一毫秒内的严格有序：用 rand_a 的 12 位当序列号（RFC 9562 §6.2 的
/// "monotonic random" 放宽版）。序列耗尽（4096 个/毫秒）时向未来借 1 毫秒，
/// 保证生成序列单调递增——本地 outbox 的 `created_at, id` 排序依赖这个性质。
public enum UUIDv7 {
    /// 生成一个 UUIDv7。
    ///
    /// - parameter date: 仅测试注入时间用；生产调用不传。
    public static func generate(at date: Date = Date()) -> UUID {
        let wallClock = Int64((date.timeIntervalSince1970 * 1000).rounded())
        return state.withLock { state in
            var milliseconds = max(wallClock, state.lastMilliseconds)
            var sequence: UInt16
            if milliseconds <= state.lastMilliseconds {
                // 同一毫秒（或系统时钟回拨）：序列号自增，保证严格递增。
                if state.sequence == 0x0FFF {
                    milliseconds = state.lastMilliseconds + 1
                    sequence = 0
                } else {
                    sequence = state.sequence + 1
                }
            } else {
                sequence = 0
            }
            state.lastMilliseconds = milliseconds
            state.sequence = sequence
            var generator = SystemRandomNumberGenerator()
            let random = UInt64.random(in: .min ... .max, using: &generator)
            return make(milliseconds: milliseconds, sequence: sequence, random: random)
        }
    }

    /// 生成 UUIDv7 的规范小写字符串（数据库主键的存储形态）。
    public static func generateString(at date: Date = Date()) -> String {
        generate(at: date).uuidString.lowercased()
    }

    /// 读出 UUIDv7 里的毫秒时间戳；不是 v7（version nibble != 7）时返回 nil。
    public static func milliseconds(of uuid: UUID) -> Int64? {
        let bytes = bytes(of: uuid)
        guard bytes[6] >> 4 == 0x7 else { return nil }
        return bytes[0...5].reduce(Int64(0)) { ($0 << 8) | Int64($1) }
    }

    // MARK: - 内部实现

    /// 进程内单调状态。`Mutex` 保证多线程并发生成也不重、不倒序。
    private struct State {
        var lastMilliseconds: Int64 = -1
        var sequence: UInt16 = 0
    }

    private static let state = Mutex(State())

    /// 按 RFC 9562 布局拼出 128 位：48 位时间戳 + 4 位版本 + 12 位序列
    /// + 2 位变体 + 62 位随机。
    private static func make(milliseconds: Int64, sequence: UInt16, random: UInt64) -> UUID {
        let timestamp = UInt64(bitPattern: milliseconds) & 0x0000_FFFF_FFFF_FFFF
        let random62 = random & 0x3FFF_FFFF_FFFF_FFFF
        let bytes: [UInt8] = [
            UInt8(truncatingIfNeeded: timestamp >> 40),
            UInt8(truncatingIfNeeded: timestamp >> 32),
            UInt8(truncatingIfNeeded: timestamp >> 24),
            UInt8(truncatingIfNeeded: timestamp >> 16),
            UInt8(truncatingIfNeeded: timestamp >> 8),
            UInt8(truncatingIfNeeded: timestamp),
            0x70 | UInt8(truncatingIfNeeded: sequence >> 8) & 0x0F,
            UInt8(truncatingIfNeeded: sequence),
            // 变体位 10xx；剩余 6 位吃掉 random62 的高 6 位。
            0x80 | UInt8(truncatingIfNeeded: random62 >> 56) & 0x3F,
            UInt8(truncatingIfNeeded: random62 >> 48),
            UInt8(truncatingIfNeeded: random62 >> 40),
            UInt8(truncatingIfNeeded: random62 >> 32),
            UInt8(truncatingIfNeeded: random62 >> 24),
            UInt8(truncatingIfNeeded: random62 >> 16),
            UInt8(truncatingIfNeeded: random62 >> 8),
            UInt8(truncatingIfNeeded: random62),
        ]
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }

    private static func bytes(of uuid: UUID) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 16)
        withUnsafeBytes(of: uuid.uuid) { raw in
            for index in 0..<16 { bytes[index] = raw[index] }
        }
        return bytes
    }
}
