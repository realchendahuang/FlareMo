// 纯 Kotlin 的数据模型：不依赖 Compose、不依赖 Android，桌面对面也能用。
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
}

kotlin {
    jvmToolchain(21)

    // AGP 9 的 KMP 写法：Android 目标由 androidLibrary 块创建，不再写 androidTarget()。
    androidLibrary {
        namespace = "dev.flaremo.core.model"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
    }

    jvm("desktop")
    sourceSets {
        commonMain.dependencies {
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

