// 两端共用的 Compose UI。
//
// 这里只有「界面」：数据来自传入的 state，不自己发请求、不自己开库。
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvmToolchain(21)

    androidLibrary {
        namespace = "dev.flaremo.ui"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
    }

    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            api(project(":core-model"))
            api(project(":core-db"))
            api(project(":core-sync"))
            api(compose.runtime)
            api(compose.foundation)
            api(compose.material3)
            api(compose.ui)
            implementation(compose.components.resources)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}


compose.resources {
    publicResClass = false
    packageOfResClass = "dev.flaremo.ui.resources"
}
