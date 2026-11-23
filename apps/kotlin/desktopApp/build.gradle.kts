// 桌面 App（Windows 走这一份，开发期在 macOS 的 JVM 上验证）。
//
// 打包成 .exe/.msi 需要 Windows 环境（jpackage 不能交叉打包），
// 但代码、界面、运行逻辑在这里就能全部验证。
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":shared-ui"))
    implementation(project(":core-sync"))
    implementation(project(":core-network"))
    implementation(compose.desktop.currentOs)
}

compose.desktop {
    application {
        mainClass = "dev.flaremo.desktop.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Exe, TargetFormat.Dmg)
            packageName = "FlareMo"
            // jpackage 要求主版本号 ≥ 1（"0.1.0" 会被直接跳过，不出安装包）。
            packageVersion = "1.0.0"
            description = "FlareMo 桌面端"
            vendor = "FlareMo"

            windows {
                menu = true
                shortcut = true
                // 只有真正在 Windows 上执行 packageMsi/packageExe 时才生效。
                upgradeUuid = "7e3f1c9a-5b2d-4a86-9f10-2c4d8e6b1a37"
            }
        }
    }
}
