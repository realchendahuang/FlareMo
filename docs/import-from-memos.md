# 从 Memos 迁移到 FlareMo

Memos 0.31 起的「导出」得到的是一个 ZIP 归档，里面是清单、每条记录的 JSON、正文 Markdown 和附件；FlareMo 的「导入」接受一份 JSON 数据包。两者字段不同，需要一步转换。仓库自带转换脚本，不依赖任何第三方包。

## 步骤

1. **在 Memos 里导出**：Settings → Data → Export，下载 `memos-export-*.zip`。
2. **转换**（需要本机装 Node.js 20 或更新版本，不需要先启动 FlareMo）：

   ```bash
   node scripts/migrate-memos-export.mjs ~/Downloads/memos-export-2026-10-31.zip flaremo-import.json
   ```

   输出会写明导入了多少条记录、多少附件，以及被跳过的内容。
3. **在 FlareMo 里导入**：左下角账户菜单 → 设置 → 导入导出 → 导入，选择刚生成的 `flaremo-import.json`。

导入前建议先在 FlareMo 里做一次全量导出，作为回滚点。

## 字段怎么对应

| Memos | FlareMo | 说明 |
| --- | --- | --- |
| `contentPath` 指向的 Markdown | 记录正文 | 原样读取，不改写 |
| `createTime` / `updateTime` | 创建 / 更新时间 | RFC 3339，保留到秒 |
| `PRIVATE` | 仅自己可见 | |
| `PROTECTED` | 团队可见 | |
| `PUBLIC` | 公开 | |
| `SPACE` | **仅自己可见** | Memos 的 Space 没有等价物；转换时收紧而不是放宽 |
| `NORMAL` / `ARCHIVED` | 正常 / 归档 | |
| `pinned` | 置顶 | |
| `#标签` | 标签 | 导入后按正文重新解析，层级标签保持一致 |

## 已知限制

- **评论会变成独立记录**：Memos 的回复有父记录关系，FlareMo 不重建这条关系，因此每条回复按普通记录导入。
- **外部链接附件会被跳过**：只有存在 ZIP 里的附件字节会被导入；`externalLink` 类型的附件需要你手动重新上传。
- **单个附件上限 25 MiB**：超过的附件会被跳过，脚本会给出警告。
- **不支持 ZIP64**：记录特别多的实例在导出时如果用了 ZIP64，请先在 Memos 里分批导出。
- **只支持 1.x 导出格式**：更早的 Memos 版本没有这套导出格式，先从 Memos 升级到 0.31 再导出。

## 验证

导入完成以后，检查三处：

1. 时间线顶部的记录数与导出报告一致；
2. 随便点开一条带图片的记录，确认附件能加载；
3. 侧栏标签数与 Memos 里一致。

如果结果不对，用导入前的导出包恢复，或把记录移入回收站后重新导入。
