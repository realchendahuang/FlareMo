# FlareMoKit 开发入口。
#
# 为什么要这一层：Xcode 装好后如果许可协议还没接受（sudo xcodebuild -license），
# 指向 Xcode 的 xcode-select 会让 swift build 直接报错。这里自动探测：
# Xcode 可用就用 Xcode 工具链（含最近 SDK），否则回落到 Command Line Tools。
# 单测与内核包编译两者都能跑，UI 预览必须等 Xcode。

XCODE_DIR := /Applications/Xcode.app/Contents/Developer
CLT_DIR := /Library/Developer/CommandLineTools

XCODE_READY := $(shell xcodebuild -version >/dev/null 2>&1 && echo yes || echo no)
# SwiftUI 的 @State/@Binding 是宏，宏插件 libSwiftUIMacros.dylib 只在 Xcode 的
# 平台目录里，CLT 不带。用 CLT 编时必须显式把插件目录指给 swiftc。
MACRO_PLUGINS := /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/usr/lib/swift/host/plugins

ifeq ($(XCODE_READY),yes)
export DEVELOPER_DIR := $(XCODE_DIR)
TOOLCHAIN := Xcode
SWIFT_FLAGS :=
else
export DEVELOPER_DIR := $(CLT_DIR)
TOOLCHAIN := CommandLineTools
SWIFT_FLAGS := $(if $(wildcard $(MACRO_PLUGINS)),-Xswiftc -plugin-path -Xswiftc $(MACRO_PLUGINS),)
endif

.PHONY: help build test fmt theme check clean toolchain

help:
	@echo "make build     编译内核包（当前工具链: $(TOOLCHAIN)）"
	@echo "make test      跑单测"
	@echo "make theme     从 apps/web/src/index.css 重新生成 Theme.swift"
	@echo "make fmt       用 swift-format 格式化（需 Xcode 工具链）"
	@echo "make clean     清 .build"
	@echo "（当前附加编译参数: $(if $(SWIFT_FLAGS),$(SWIFT_FLAGS),无)）"

toolchain:
	@echo "$(TOOLCHAIN) → $(DEVELOPER_DIR)"

build:
	@swift build $(SWIFT_FLAGS)

test:
	@swift test $(SWIFT_FLAGS)

theme:
	@cd ../../.. && node scripts/apple/gen-theme.mjs

fmt:
	@swift format --in-place --recursive Sources Tests Package.swift

clean:
	@swift package clean
