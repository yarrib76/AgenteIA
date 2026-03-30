plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("com.google.gms.google-services")
}

android {
  namespace = "com.agenteia.internalchat"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.agenteia.internalchat"
    minSdk = 26
    targetSdk = 35
    versionCode = 2
    versionName = "1.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    val backendBaseUrl = providers.gradleProperty("backend.baseUrl")
      .orElse("http://10.0.2.2:3000/")
      .get()
    buildConfigField("String", "BACKEND_BASE_URL", "\"$backendBaseUrl\"")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    buildConfig = true
  }
}

dependencies {
  implementation("androidx.activity:activity-ktx:1.9.1")
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.constraintlayout:constraintlayout:2.1.4")
  implementation("androidx.recyclerview:recyclerview:1.3.2")
  implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
  implementation("com.squareup.retrofit2:retrofit:2.11.0")
  implementation("com.squareup.retrofit2:converter-gson:2.11.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
  implementation("io.coil-kt:coil:2.7.0")
  implementation(platform("com.google.firebase:firebase-bom:33.2.0"))
  implementation("com.google.firebase:firebase-messaging")
  implementation("io.socket:socket.io-client:2.1.1") {
    exclude(group = "org.json", module = "json")
  }
}
