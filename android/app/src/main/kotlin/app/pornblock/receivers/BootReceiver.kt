package app.pornblock.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.pornblock.PornBlockApplication
import app.pornblock.screen.ScreenMonitorService
import app.pornblock.services.HeartbeatService
import app.pornblock.vpn.PornBlockVpnService
import app.pornblock.workers.HeartbeatWorker
import java.util.concurrent.TimeUnit

private const val TAG = "BootReceiver"

/**
 * Restarts all protection services after device reboot or after the app
 * is updated (ACTION_MY_PACKAGE_REPLACED).
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in HANDLED_ACTIONS) return

        val storage = (context.applicationContext as PornBlockApplication).secureStorage
        if (!storage.isEnrolled()) {
            Log.d(TAG, "Not enroled — skipping service start")
            return
        }

        Log.i(TAG, "Boot/update detected — restarting protection services")

        // 1. VPN — only start if user has already granted the permission
        val vpnIntent = VpnService.prepare(context)
        if (vpnIntent == null) {
            // Permission already granted: start directly
            PornBlockVpnService.start(context)
        } else {
            // Need the user to re-grant from UI — cannot start headlessly
            Log.w(TAG, "VPN permission not granted; cannot auto-start VPN after boot")
        }

        // 2. Heartbeat foreground service
        HeartbeatService.start(context)

        // 3. WorkManager periodic backup heartbeat (15-min minimum)
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "heartbeat_backup",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .build()
        )

        Log.i(TAG, "All protection services started")
    }

    companion object {
        private val HANDLED_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.MY_PACKAGE_REPLACED",
        )
    }
}
