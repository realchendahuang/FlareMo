// 本地库。
//
// 为什么不按文档用 Room 3：Room 的 KMP 版本还不存在（Android Maven 上最新是 2.8.5），
// 而 Room 的代码生成依赖 KSP，AGP 9 的内置 Kotlin 目前不吃 KSP。
// 所以 v1 用 androidx.sqlite（多平台）+ BundledSQLiteDriver + 手写 SQL：
// SQLite 版本钉死在依赖里，不依赖系统；接口层仍是 Repository，将来换 Room 不动上层。
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
}

kotlin {
    jvmToolchain(21)

    androidLibrary {
        namespace = "dev.flaremo.core.db"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
    }

    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core-model"))
            api(libs.androidx.sqlite)
            api(libs.androidx.sqlite.bundled)
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
    }
}
