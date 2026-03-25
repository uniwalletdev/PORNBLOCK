package app.pornblock.network

import com.google.gson.annotations.SerializedName

// ── Enrolment ─────────────────────────────────────────────────────────────────

data class EnrolmentResponse(
    @SerializedName("device_name")    val deviceName: String,
    @SerializedName("platform")       val platform: String?,
    @SerializedName("policy")         val policy: PolicyConfig,
    @SerializedName("instructions")   val instructions: InstallInstructions?,
)

data class PolicyConfig(
    @SerializedName("sensitivity_level") val sensitivityLevel: String,
    @SerializedName("custom_allowlist")  val customAllowlist: List<String>,
    @SerializedName("custom_blocklist")  val customBlocklist: List<String>,
)

data class InstallInstructions(
    @SerializedName("label")  val label: String,
    @SerializedName("action") val action: String,
    @SerializedName("url")    val url: String,
    @SerializedName("steps")  val steps: List<String>,
)

// ── Heartbeat ─────────────────────────────────────────────────────────────────

data class HeartbeatRequest(
    @SerializedName("device_id")         val deviceId: String,
    @SerializedName("protection_status") val protectionStatus: String,
    @SerializedName("battery_level")     val batteryLevel: Int,
    @SerializedName("app_version")       val appVersion: String,
    @SerializedName("vpn_active")        val vpnActive: Boolean,
    @SerializedName("screen_monitor")    val screenMonitor: Boolean,
)

data class HeartbeatResponse(
    @SerializedName("device") val device: DeviceStatus,
)

data class DeviceStatus(
    @SerializedName("id")                val id: String,
    @SerializedName("protection_status") val protectionStatus: String,
    @SerializedName("last_heartbeat")    val lastHeartbeat: String,
)

// ── Violation ─────────────────────────────────────────────────────────────────

data class ViolationRequest(
    @SerializedName("device_id")         val deviceId: String,
    @SerializedName("violation_type")    val violationType: String,
    @SerializedName("url")               val url: String?,
    @SerializedName("details")           val details: ViolationDetails?,
)

data class ViolationDetails(
    @SerializedName("confidence_score")  val confidenceScore: Float,
    @SerializedName("screenshot_hash")  val screenshotHash: String?,
    @SerializedName("source")           val source: String,
)

// ── Tamper Alert ──────────────────────────────────────────────────────────────

data class TamperAlertRequest(
    @SerializedName("device_id")    val deviceId: String,
    @SerializedName("event_type")   val eventType: String,   // "admin_disable_requested" | "uninstall_attempt"
    @SerializedName("timestamp")    val timestamp: String,
)

// ── Generic API response ──────────────────────────────────────────────────────

data class ApiError(
    @SerializedName("error") val error: String,
)
