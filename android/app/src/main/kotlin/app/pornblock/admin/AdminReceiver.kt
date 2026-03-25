package app.pornblock.admin

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import app.pornblock.PornBlockApplication
import app.pornblock.network.ApiClient
import app.pornblock.network.TamperAlertRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant

private const val TAG = "AdminReceiver"

class AdminReceiver : DeviceAdminReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // ── Admin disable attempted ───────────────────────────────────────────────

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        Log.w(TAG, "Device Admin disable requested — alerting server")
        alertServer(context, "admin_disable_requested")
        // Return warning text shown in the system confirm dialog
        return context.getString(app.pornblock.R.string.admin_disable_warning)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.w(TAG, "Device Admin disabled")
        alertServer(context, "admin_disabled")
    }

    // ── Password changed / failed login ───────────────────────────────────────

    override fun onPasswordChanged(context: Context, intent: Intent) {
        Log.i(TAG, "Device password changed")
    }

    override fun onPasswordFailed(context: Context, intent: Intent) {
        Log.w(TAG, "Failed password attempt")
        alertServer(context, "password_failed")
    }

    // ── Server alert ──────────────────────────────────────────────────────────

    private fun alertServer(context: Context, eventType: String) {
        scope.launch {
            try {
                val storage  = (context.applicationContext as PornBlockApplication).secureStorage
                val deviceId = storage.getDeviceId() ?: return@launch
                val api      = ApiClient.getService(storage)

                api.reportTamper(
                    TamperAlertRequest(
                        deviceId  = deviceId,
                        eventType = eventType,
                        timestamp = Instant.now().toString(),
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to alert server: ${e.message}")
            }
        }
    }

    companion object {
        fun getComponentName(context: Context): ComponentName =
            ComponentName(context, AdminReceiver::class.java)
    }
}
