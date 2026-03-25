# Keep TFLite classes
-keep class org.tensorflow.** { *; }
-keep class org.tensorflow.lite.** { *; }

# Keep Retrofit service interfaces
-keep interface app.pornblock.network.** { *; }
-keep class app.pornblock.network.** { *; }

# Keep Device Admin receiver
-keep class app.pornblock.admin.AdminReceiver { *; }

# Keep VPN service
-keep class app.pornblock.vpn.PornBlockVpnService { *; }

# OkHttp / Retrofit
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# Gson
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn sun.misc.**
-keep class com.google.gson.** { *; }
