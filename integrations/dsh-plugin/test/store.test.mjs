/**
 * ConnectionStore 单测：凭据服务持久化、undefined 清理、服务缺席时的内存降级。
 *
 * 用假的 credentials 服务模拟 dsh-credentials-local 的两条硬约束：
 *  - 记录 key 必须是 `<scope>/<id>`；
 *  - grant payload 必须能过 JSON 往返（不能带 undefined / 非有限数）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ConnectionStore, RECORD_KEY, STATE_VERSION, toJsonValue } from '../lib/store.js'

/** 严格模拟 credentials-local 的 payload 校验。 */
function assertJsonValue(where, value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError(`${where} is cyclic`)
    seen.add(value)
    for (const nested of Object.values(value)) assertJsonValue(where, nested, seen)
    seen.delete(value)
    return
  }
  throw new TypeError(`${where} holds a value JSON cannot represent`)
}

/** 假 credentials 服务（只实现 store 用到的三个方法）。 */
function createCredentials() {
  const records = new Map()
  return {
    records,
    async readRecord(key) {
      return records.get(key)
    },
    async modifyRecord(key, mutate) {
      assert.match(key, /^[a-z0-9-]+\/[a-z0-9-]+$/)
      const current = records.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      assertJsonValue(`record "${key}" payload`, next.payload)
      records.set(key, next)
      return next
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

test('toJsonValue：剥掉 undefined，保留 boolean / number / null', () => {
  assert.deepEqual(toJsonValue({ a: 1, b: undefined, c: null, d: { e: undefined, f: 'x' } }), {
    a: 1,
    c: null,
    d: { f: 'x' },
  })
  // 数组里的 undefined 按 JSON 语义变成 null
  assert.deepEqual(toJsonValue([1, undefined]), [1, null])
})

test('内存降级：没有 credentials 服务也能读写', async () => {
  const store = new ConnectionStore({ get: () => undefined, logger: () => ({ warn() {} }) })
  assert.equal(await store.read(), undefined)
  await store.write({ instanceUrl: 'https://x.test' })
  const state = await store.read()
  assert.equal(state.instanceUrl, 'https://x.test')
  assert.equal(state.version, STATE_VERSION)
  await store.clear()
  assert.equal(await store.read(), undefined)
})

test('credentials 记录：写入带 version 的 grant，读到同样的 payload', async () => {
  const credentials = createCredentials()
  const store = new ConnectionStore({ get: (name) => (name === 'credentials' ? credentials : undefined) })

  await store.write({ instanceUrl: 'https://x.test', accessToken: 'a', refreshToken: 'r', account: { name: 'Kim' } })

  assert.deepEqual([...credentials.records.keys()], [RECORD_KEY])
  const record = credentials.records.get(RECORD_KEY)
  assert.equal(record.kind, 'grant')
  assert.equal(record.payload.version, STATE_VERSION)
  assert.equal(record.payload.accessToken, 'a')

  const read = await store.read()
  assert.deepEqual(read, record.payload)
})

test('写入前剥掉 undefined，避免凭据服务拒绝整份状态', async () => {
  const credentials = createCredentials()
  const store = new ConnectionStore({ get: () => credentials })

  // 真的会出现：connectStart 清 token 时传的是 undefined
  await store.write({ instanceUrl: 'https://x.test', accessToken: undefined, refreshToken: undefined })

  const record = credentials.records.get(RECORD_KEY)
  assert.equal('accessToken' in record.payload, false)
  assert.equal(record.payload.instanceUrl, 'https://x.test')
})

test('版本不对的记录当作没有连接', async () => {
  const credentials = createCredentials()
  credentials.records.set(RECORD_KEY, { kind: 'grant', payload: { version: 99, instanceUrl: 'https://old.test' } })
  const store = new ConnectionStore({ get: () => credentials })
  assert.equal(await store.read(), undefined)
})

test('clear 删除记录', async () => {
  const credentials = createCredentials()
  const store = new ConnectionStore({ get: () => credentials })
  await store.write({ instanceUrl: 'https://x.test' })
  assert.equal(credentials.records.size, 1)
  await store.clear()
  assert.equal(credentials.records.size, 0)
  assert.equal(await store.read(), undefined)
})

test('凭据服务写失败时不抛给调用方，内存副本仍可读', async () => {
  const store = new ConnectionStore({
    get: () => ({
      async readRecord() {
        throw new Error('disk full')
      },
      async modifyRecord() {
        throw new Error('disk full')
      },
      async deleteRecord() {},
    }),
    logger: () => ({ warn() {} }),
  })
  await store.write({ instanceUrl: 'https://x.test' })
  const read = await store.read()
  assert.equal(read.instanceUrl, 'https://x.test')
})
