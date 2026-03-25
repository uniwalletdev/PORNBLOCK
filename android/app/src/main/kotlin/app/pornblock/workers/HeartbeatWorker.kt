package app.pornblock.workers

import android.content.Context
import android.content.IntentFilter
import android.os.BatteryManager
import android.content.Intent
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import app.pornblock.BuildConfig
import app.pornblock.network.ApiClient
import app.pornblock.network.HeartbeatRequest
import app.pornblock.storage.SecureStorage

private const val TAG = "HeartbeatWorker"

/**
 * WorkManager fallback for the 60-second foreground service heartbeat.
 * Fires every ≥15 minutes (WorkManager minimum) to ensure the server
 * knows the device is alive even if HeartbeatService was killed.
 */
class HeartbeatWorker(
    context: Context,
    params: WorkerParameters,
    private val storage: SecureStorage,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val api      = ApiClient.getService(storage)
            val deviceId = storage.getDeviceId() ?: return Result.failure()

            val request = HeartbeatRequest(
                deviceId         = deviceId,
                protectionStatus = "active",
                batteryLevel     = getBatteryLevel(),
                appVersion       = getAppVersion(),
                vpnActive        = false,  // WorkManager tasks run without service context
                screenMonitor    = false,
            )

            val response = api.sendHeartbeat(request)
            if (response.isSuccessful) {
                Log.d(TAG, "WorkManager heartbeat OK")
                Result.success()
            } else {
                Log.w(TAG, "WorkManager heartbeat HTTP ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "WorkManager heartbeat error: ${e.message}")
            Result.retry()
        }
    }

    private fun getBatteryLevel(): Int {
        val intent = applicationContext.registerReceiver(
            null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        ) ?: return -1
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (scale > 0) level * 100 / scale else -1
    }

    private fun getAppVersion(): String = try {
        applicationContext.packageManager
            .getPackageInfo(applicationContext.packageName, 0)
            .versionName ?: "unknown"
    } catch (e: Exception) { "unknown" }

    // ── Custom WorkerFactory for DI ───────────────────────────────────────────

    class Factory(private val storage: SecureStorage) : WorkerFactory() {
        override fun createWorker(
            appContext: Context,
            workerClassName: String,
            workerParameters: WorkerParameters,
        ): HeartbeatWorker? {
            return if (workerClassName == HeartbeatWorker::class.java.name) {
                HeartbeatWorker(appContext, workerParameters, storage)
            } else null
        }
    }
}
