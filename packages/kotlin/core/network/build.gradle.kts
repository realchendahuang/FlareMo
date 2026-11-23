// 网络层：Ktor client + `docs/native-clients.md` §4.4 的同步契约。
//
// 这一层只有「怎么发请求、怎么解响应」，不含业务状态；同步算法在 :core-sync。
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    jvmToolchain(21)

    androidLibrary {
        namespace = "dev.flaremo.core.network"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
    }

    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            api(project(":core-model"))
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
            api(libs.ktor.client.core)
            api(libs.ktor.client.content.negotiation)
            api(libs.ktor.serialization.kotlinx.json)
        }
        androidMain.dependencies {
            // Android 用 CIO 引擎。文档 §6.3 首选 OkHttp，但 ktor-client-okhttp 3.6.1
            // 拉到的 okhttp-android 5.5.1 要求 compileSdk 37，而项目钉在 36；
            // CIO 是纯 Kotlin 实现，行为等价且不引入 Android AAR。
            api(libs.ktor.client.cio)
        }
        val desktopMain by getting {
            dependencies {
                // 桌面（Windows）用同一份 OkHttp JVM 引擎，省一套引擎的差异。
                api(libs.ktor.client.okhttp)
            }
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
            }
        }
    }
}
