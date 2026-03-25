package app.pornblock.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import app.pornblock.MainActivity
import app.pornblock.PornBlockApplication
import app.pornblock.R
import app.pornblock.network.ApiClient
import app.pornblock.network.HeartbeatRequest
import app.pornblock.vpn.PornBlockVpnService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val TAG               = "HeartbeatService"
private const val NOTIFICATION_ID   = 1002
private const val CHANNEL_ID        = "heartbeat_channel"
private const val INTERVAL_MS       = 60_000L  // 60 seconds

class HeartbeatService : LifecycleService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var handler: Handler
    private lateinit var handlerThread: HandlerThread

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendHeartbeat()
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        handlerThread = HandlerThread("HeartbeatThread").also { it.start() }
        handler = Handler(handlerThread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        handler.post(heartbeatRunnable)
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    override fun onDestroy() {
        handler.removeCallbacks(heartbeatRunnable)
        handlerThread.quitSafely()
        scope.cancel()
        super.onDestroy()
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────

    private fun sendHeartbeat() {
        scope.launch {
            try {
                val app     = application as PornBlockApplication
                val storage = app.secureStorage
                val api     = ApiClient.getService(storage)

                val deviceId = storage.getDeviceId() ?: return@launch
                val request = HeartbeatRequest(
                    deviceId         = deviceId,
                    protectionStatus = "active",
                    batteryLevel     = getBatteryLevel(),
                    appVersion       = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "unknown",
                    vpnActive        = isVpnActive(),
                    screenMonitor    = isScreenMonitorActive(),
                )

                val response = api.sendHeartbeat(request)
                if (!response.isSuccessful) {
                    Log.w(TAG, "Heartbeat failed: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Heartbeat error: ${e.message}")
            }
        }
    }

    private fun getBatteryLevel(): Int {
        val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: return -1
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (scale > 0) (level * 100 / scale) else -1
    }

    private fun isVpnActive(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        @Suppress("DEPRECATION")
        val vpnNetwork = cm.activeNetworkInfo
        return cm.allNetworks.any { network ->
            cm.getNetworkCapabilities(network)
                ?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) == true
        }
    }

    private fun isScreenMonitorActive(): Boolean {
        // Check if ScreenMonitorService is running
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        @Suppress("DEPRECATION")
        return manager.getRunningServices(Int.MAX_VALUE).any {
            it.service.className.contains("ScreenMonitorService")
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_heartbeat),
            NotificationManager.IMPORTANCE_MIN,
        ).apply {
            description = getString(R.string.notification_channel_heartbeat_desc)
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_heartbeat_title))
            .setContentText(getString(R.string.notification_heartbeat_text))
            .setSmallIcon(R.drawable.ic_shield)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(tapIntent)
            .build()
    }

    companion object {
        const val ACTION_STOP = "app.pornblock.HEARTBEAT_STOP"

        fun start(context: Context) =
            context.startForegroundService(Intent(context, HeartbeatService::class.java))

        fun stop(context: Context) =
            context.startService(
                Intent(context, HeartbeatService::class.java).apply { action = ACTION_STOP }
            )
    }
}
