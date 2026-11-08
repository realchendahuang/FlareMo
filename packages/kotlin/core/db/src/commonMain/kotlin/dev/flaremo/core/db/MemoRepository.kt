package dev.flaremo.core.db

import dev.flaremo.core.model.Memo

/**
 * 界面唯一的数据入口。
 *
 * 界面不直接碰数据库：这样将来换实现（Room、或者带同步的仓库）时视图不用动。
 */
interface MemoRepository {
    fun list(limit: Int = 200): List<Memo>
    fun count(): Int
    fun pendingSyncCount(): Int
    fun create(content: String, tags: List<String> = emptyList()): Memo
    fun setPinned(id: String, pinned: Boolean)
    fun delete(id: String)
}

/** SQLite 实现。所有写操作都落本地库，网络同步是另一条链路（M0 之后接）。 */
class SqliteMemoRepository(private val database: FlareMoDatabase) : MemoRepository {
    override fun list(limit: Int): List<Memo> = database.listMemos(limit)

    override fun count(): Int = database.countMemos()

    override fun pendingSyncCount(): Int = database.pendingOutboxCount()

    override fun create(content: String, tags: List<String>): Memo {
        val trimmed = content.trim()
        val id = Ids.uuidV7()
        val now = nowIso()
        database.insertMemo(id = id, content = trimmed, tags = tags, now = now, source = "native")
        return Memo(
            id = id,
            content = trimmed,
            createdAt = now,
            updatedAt = now,
            pinned = false,
            tags = tags,
        )
    }

    override fun setPinned(id: String, pinned: Boolean) = database.setPinned(id, pinned)

    override fun delete(id: String) = database.softDelete(id)
}
