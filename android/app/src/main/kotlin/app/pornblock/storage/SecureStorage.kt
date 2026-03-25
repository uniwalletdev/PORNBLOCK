package app.pornblock.storage

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Thin wrapper around EncryptedSharedPreferences.
 * All device credentials are stored here – never in plain SharedPreferences.
 */
class SecureStorage(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "pornblock_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    // ── Device token ──────────────────────────────────────────────────────────

    fun saveDeviceToken(token: String) = prefs.edit().putString(KEY_DEVICE_TOKEN, token).apply()

    fun getDeviceToken(): String? = prefs.getString(KEY_DEVICE_TOKEN, null)

    fun isEnrolled(): Boolean = getDeviceToken() != null

    // ── Device ID (UUID, persisted across re-enrolments) ──────────────────────

    fun saveDeviceId(id: String) = prefs.edit().putString(KEY_DEVICE_ID, id).apply()

    fun getDeviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)

    // ── Media projection permission data ─────────────────────────────────────

    fun saveProjectionResultCode(code: Int) =
        prefs.edit().putInt(KEY_PROJECTION_CODE, code).apply()

    fun getProjectionResultCode(): Int = prefs.getInt(KEY_PROJECTION_CODE, -1)

    // ── Policy ───────────────────────────────────────────────────────────────

    fun saveSensitivityLevel(level: String) =
        prefs.edit().putString(KEY_SENSITIVITY, level).apply()

    fun getSensitivityLevel(): String = prefs.getString(KEY_SENSITIVITY, "standard") ?: "standard"

    // ── Custom blocklist/allowlist (serialised as newline-joined strings) ─────

    fun saveCustomBlocklist(domains: List<String>) =
        prefs.edit().putString(KEY_BLOCKLIST, domains.joinToString("\n")).apply()

    fun getCustomBlocklist(): List<String> =
        prefs.getString(KEY_BLOCKLIST, null)?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()

    fun saveCustomAllowlist(domains: List<String>) =
        prefs.edit().putString(KEY_ALLOWLIST, domains.joinToString("\n")).apply()

    fun getCustomAllowlist(): List<String> =
        prefs.getString(KEY_ALLOWLIST, null)?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()

    // ── Wipe ─────────────────────────────────────────────────────────────────

    fun clearAll() = prefs.edit().clear().apply()

    companion object {
        private const val KEY_DEVICE_TOKEN  = "device_token"
        private const val KEY_DEVICE_ID     = "device_id"
        private const val KEY_PROJECTION_CODE = "projection_result_code"
        private const val KEY_SENSITIVITY   = "sensitivity_level"
        private const val KEY_BLOCKLIST     = "custom_blocklist"
        private const val KEY_ALLOWLIST     = "custom_allowlist"
    }
}
