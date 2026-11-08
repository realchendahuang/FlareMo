import Foundation
import Testing
@testable import FlareMoCore

/// 本文件负责：UUIDv7 生成器的单测 —— 时间有序、唯一、版本/变体位正确。
@Suite("UUIDv7")
struct UUIDv7Tests {
    @Test("连续 1000 个 UUIDv7 严格递增且不重复")
    func strictMonotonicOrdering() {
        var strings: [String] = []
        strings.reserveCapacity(1000)
        for _ in 0..<1000 {
            strings.append(UUIDv7.generateString())
        }

        for (previous, next) in zip(strings, strings.dropFirst()) {
            #expect(previous < next, "UUIDv7 应字符串有序：\(previous) !< \(next)")
        }
        #expect(Set(strings).count == strings.count, "UUIDv7 不能重复")
    }

    @Test("时间戳在 UUIDv7 的前 48 位，且能读回来")
    func embedsMilliseconds() {
        let before = Int64(Date().timeIntervalSince1970 * 1000)
        let uuid = UUIDv7.generate()
        let after = Int64(Date().timeIntervalSince1970 * 1000)

        let milliseconds = UUIDv7.milliseconds(of: uuid)
        #expect(milliseconds != nil)
        if let milliseconds {
            // 生成器是进程内单例（单调递增），并发跑测试时别的用例可能已经把
            // 水位推到当前时钟附近；这里给 1 秒容差，只证明「时间戳就是生成时刻」。
            #expect(milliseconds >= before - 1000, "时间戳不能明显早于调用前的时钟")
            #expect(milliseconds <= after + 1000, "时间戳不能明显晚于调用后的时钟")
        }
    }

    @Test("版本位 = 7、变体位 = 10")
    func versionAndVariantBits() {
        for _ in 0..<50 {
            let string = UUIDv7.generateString()
            let characters = Array(string)
            #expect(characters.count == 36)
            // xxxxxxxx-xxxx-Mxxx-Vxxx-xxxxxxxxxxxx：第 15 个字符是版本号。
            #expect(characters[14] == "7")
            #expect(["8", "9", "a", "b"].contains(String(characters[19])))
        }
    }

    @Test("同一毫秒内生成也严格递增（序列号兜底）")
    func monotonicWithinSameMillisecond() {
        let fixed = Date(timeIntervalSince1970: 1_700_000_000)
        var strings: [String] = []
        for _ in 0..<100 {
            strings.append(UUIDv7.generate(at: fixed).uuidString.lowercased())
        }
        for (previous, next) in zip(strings, strings.dropFirst()) {
            #expect(previous < next)
        }
        // 单调生成器不允许时间倒退：传入过去时间时仍会用「已知最大毫秒」，
        // 因此只断言时间戳不早于该固定日期、且整批非递减（序列号兜底保证严格递增）。
        let timestamps = strings.compactMap { string in
            UUID(uuidString: string).flatMap(UUIDv7.milliseconds(of:))
        }
        #expect(timestamps.count == 100)
        if let first = timestamps.first {
            #expect(first >= 1_700_000_000_000)
        }
        for (previous, next) in zip(timestamps, timestamps.dropFirst()) {
            #expect(previous <= next)
        }
    }

    @Test("非 v7 UUID 读时间戳返回 nil")
    func rejectsNonV7() {
        #expect(UUIDv7.milliseconds(of: UUID()) == nil)
        #expect(UUIDv7.milliseconds(of: UUID(uuidString: "00000000-0000-4000-8000-000000000000")!) == nil)
    }
}
