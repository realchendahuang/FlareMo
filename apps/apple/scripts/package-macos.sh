#!/usr/bin/env bash
# 把 SwiftPM 的 FlareMoMac 可执行文件打成 .app。
#
# 为什么有这个脚本：正式分发走 Xcode 工程（签名、公证、Sparkle 都要它），
# 但在工程还没建好、或者只改了内核包想快速看一眼时，手搓一个 .app 是最快的路。
# 产物在 Temp/build/FlareMo.app，Temp/ 已 gitignore。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/apple/FlareMoKit"
# Xcode 许可未接受时回落到 Command Line Tools（Makefile 里同一套判断）。
if xcodebuild -version >/dev/null 2>&1; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
else
    export DEVELOPER_DIR="/Library/Developer/CommandLineTools"
fi
# SwiftUI 的属性包装是宏，CLT 不带 SwiftUIMacros 插件，这里显式指到 Xcode 的插件目录。
PLUGIN_DIR="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/usr/lib/swift/host/plugins"
SWIFT_FLAGS=(-Xswiftc -plugin-path -Xswiftc "$PLUGIN_DIR")

CONFIG="${1:-debug}"
cd "$PACKAGE_DIR"
echo "▸ 编译（${CONFIG}）"
swift build -c "$CONFIG" --product FlareMoMac "${SWIFT_FLAGS[@]}"

BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
APP="$REPO_ROOT/Temp/build/FlareMo.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/FlareMoMac" "$APP/Contents/MacOS/FlareMo"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>FlareMo</string>
    <key>CFBundleDisplayName</key><string>FlareMo</string>
    <key>CFBundleExecutable</key><string>FlareMo</string>
    <key>CFBundleIdentifier</key><string>app.flaremo.macos.dev</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>NSHumanReadableCopyright</key><string>FlareMo</string>
    <key>NSSupportsAutomaticTermination</key><true/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# 本地测速用 ad-hoc 签名：没它 macOS 会因为「未签名」限制部分能力。
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "✓ $APP"
