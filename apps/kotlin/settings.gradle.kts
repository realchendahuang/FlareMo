// FlareMo Kotlin 多平台工程（Android + 桌面/Windows）。
//
// Gradle 根放在 apps/kotlin，内核模块留在 packages/kotlin，
// 用 projectDir 指过去——保持「App 在 apps、内核在 packages」的仓库约定。
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "FlareMoKotlin"

include(
    ":androidApp",
    ":desktopApp",
    ":core-model",
    ":core-db",
    ":core-network",
    ":core-sync",
    ":shared-ui",
)

project(":core-model").projectDir = file("../../packages/kotlin/core/model")
project(":core-db").projectDir = file("../../packages/kotlin/core/db")
project(":core-network").projectDir = file("../../packages/kotlin/core/network")
project(":core-sync").projectDir = file("../../packages/kotlin/core/sync")
project(":shared-ui").projectDir = file("../../packages/kotlin/shared/ui")
