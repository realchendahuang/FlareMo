//
//  FMReadingSample.swift
//  FlareMoUI
//
//  职责：给 `FlareMoPreview` / Xcode 预览 / 目检用的样例文档。
//  和 `FMBlockView` 放在一起：改块模型或改渲染时，先让这份样例仍能完整展示
//  所有块级形态（标题 1–6、段落、两种列表、引用、代码块、分隔线、两种待办）
//  和所有行内样式（粗/斜/粗斜/删除线/行内代码/链接/标签），再谈别的。
//

import Foundation

/// 阅读态样例：一份把所有块级与行内形态都用上的速记。
public enum FMReadingSample {
    public static let markdown = """
    # 阅读态功能清单

    这条记录用来目检 `FMBlockView`：**加粗**、*斜体*、***粗斜***、`行内代码`、~~删除线~~、
    [链接](https://flaremo.app)、#标签 #笔记/读书 都应该按各自的样式出现，
    emoji 😀🚀 与中文混排时偏移不能错位。

    ## 二级标题

    第二段正文。段落之间只留 4pt（Web 端 `p + p` 的 `mt-1`），块与块之间留 12pt（`mt-3`）。

    ### 三级标题

    #### 四级标题退化为正文加粗

    ##### 五级标题同理

    ###### 六级标题同理

    - 无序列表第一项
    - 第二项，**带行内样式**
    - 第三项，长到需要折行看看悬挂缩进对不对：写文档的时候，先写清楚为什么，再写怎么做；
      第二行应该和第一行的正文左缘对齐，而不是钻到项目符号下面。

    1. 有序列表第一项
    2. 第二项
    3. 第三项

    > 引用：写文档的时候，先写清楚为什么，再写怎么做。
    >
    > 这是引用的第二段，颜色应该比正文浅一档。

    ```swift
    func ping(_ url: URL) async throws -> Bool {
        let (_, response) = try await URLSession.shared.data(from: url)
        return (response as? HTTPURLResponse)?.statusCode == 200
    }
    ```

    ---

    - [ ] 未完成的待办
    - [x] 已完成的待办

    最后一段：分隔线上下应该各有留白，待办勾选框与正文首行居中。
    """
}
