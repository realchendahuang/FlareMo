// Android App：只有一层壳，界面全在 :shared:ui（与桌面端共用）。
plugins {
    alias(libs.plugins.androidApplication)
    // AGP 9 起 Kotlin 支持内置在 android 插件里，不能再叠加 org.jetbrains.kotlin.android。
    alias(libs.plugins.composeCompiler)
}

android {
    namespace = "dev.flaremo.android"
    compileSdk = libs.versions.androidCompileSdk.get().toInt()

    defaultConfig {
        applicationId = "dev.flaremo.android"
        minSdk = libs.versions.androidMinSdk.get().toInt()
        targetSdk = libs.versions.androidTargetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":shared-ui"))
    implementation(project(":core-sync"))
    implementation(project(":core-network"))
    implementation(libs.androidx.activity.compose)
}
