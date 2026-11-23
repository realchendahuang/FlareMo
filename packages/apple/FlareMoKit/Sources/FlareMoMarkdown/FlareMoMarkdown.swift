//
//  FlareMoMarkdown.swift
//  FlareMoMarkdown
//
//  职责：模块门面与版本号。真正的实现在四个文件里：
//
//  - `FMSourceSpan`  ：span 与种类的公共类型（UTF-16 偏移口径）
//  - `FMInlineScanner`：手写单遍扫描器，编辑器逐键调用（**不用** swift-markdown AST）
//  - `FMBlock`       ：阅读态块模型
//  - `FMBlockParser` ：用 swift-markdown 解析成块模型（阅读态在解析质量上更划算）
//
//  这个包是纯逻辑：不 import AppKit / UIKit，不碰字体和颜色。视图层拿到 span / 块之后
//  自己翻译成 `NSAttributedString` 或 SwiftUI 视图（见 docs/native-clients.md §5.5、§5.6）。
//

import Foundation

/// Markdown 解析与行内样式计算（纯逻辑，不依赖 UIKit/AppKit）。
public enum FlareMoMarkdown {
    public static let version = "0.1.0"
}
