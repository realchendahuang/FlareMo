// 同步引擎：拉（changes + hydrate）+ 推（outbox → REST）+ 状态机。
//
// 依赖方向：:core-sync → :core-db（本地库）与 :core-network（HTTP）；
// 反过来两条都不依赖同步层，换传输层（假传输、测试）不用动库和界面。
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    jvmToolchain(21)

    androidLibrary {
        namespace = "dev.flaremo.core.sync"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
    }

    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            api(project(":core-model"))
            api(project(":core-db"))
            api(project(":core-network"))
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
                implementation(libs.ktor.client.okhttp)
            }
        }
    }
}

// 端到端探针（LiveSyncProbeTest）要用真实实例的地址与 PAT：
// 通过 -Pflaremo.baseUrl=… -Pflaremo.token=… 传入，测试没拿到就自己跳过。
tasks.withType<org.gradle.api.tasks.testing.Test>().configureEach {
    val baseUrl = providers.gradleProperty("flaremo.baseUrl").orNull
        ?: System.getenv("FLAREMO_BASE_URL")
    val token = providers.gradleProperty("flaremo.token").orNull
        ?: System.getenv("FLAREMO_TOKEN")
    if (!baseUrl.isNullOrBlank()) systemProperty("flaremo.baseUrl", baseUrl)
    if (!token.isNullOrBlank()) systemProperty("flaremo.token", token)
    providers.gradleProperty("flaremo.push").orNull?.let { systemProperty("flaremo.push", it) }
    testLogging {
        showStandardStreams = true
    }
}
