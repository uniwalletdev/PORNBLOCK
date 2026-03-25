package app.pornblock.screen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import app.pornblock.BlockOverlayActivity
import app.pornblock.MainActivity
import app.pornblock.PornBlockApplication
import app.pornblock.R
import app.pornblock.network.ApiClient
import app.pornblock.network.ViolationDetails
import app.pornblock.network.ViolationRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.time.Instant

private const val TAG             = "ScreenMonitorService"
private const val NOTIFICATION_ID = 1003
private const val CHANNEL_ID      = "screen_monitor_channel"
private const val CAPTURE_INTERVAL_MS  = 2_000L   // capture every 2 seconds
private const val NSFW_THRESHOLD       = 0.85f    // flag if NSFW confidence ≥ 85 %

class ScreenMonitorService : LifecycleService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var projection: MediaProjection?   = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader?       = null
    private lateinit var classifier: NsfwClassifier

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        classifier = NsfwClassifier(this)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val data       = intent?.getParcelableExtra<Intent>(EXTRA_DATA)

        if (resultCode == -1 || data == null) {
            Log.e(TAG, "Missing MediaProjection result; cannot start screen monitor")
            stopSelf()
            return START_NOT_STICKY
        }

        startCapture(resultCode, data)
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    override fun onDestroy() {
        scope.cancel()
        virtualDisplay?.release()
        imageReader?.close()
        projection?.stop()
        classifier.close()
        super.onDestroy()
    }

    // ── Screen capture ────────────────────────────────────────────────────────

    private fun startCapture(resultCode: Int, data: Intent) {
        val projManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = projManager.getMediaProjection(resultCode, data)

        val wm      = getSystemService(WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getMetrics(metrics)
        val width  = metrics.widthPixels
        val height = metrics.heightPixels
        val dpi    = metrics.densityDpi

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

        virtualDisplay = projection!!.createVirtualDisplay(
            "PornBlockCapture",
            width, height, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, null
        )

        startAnalysisLoop(width, height)
    }

    private fun startAnalysisLoop(width: Int, height: Int) {
        scope.launch {
            while (isActive) {
                delay(CAPTURE_INTERVAL_MS)
                val bitmap = captureFrame(width, height) ?: continue
                val score  = withContext(Dispatchers.Default) { classifier.classify(bitmap) }
                bitmap.recycle()

                if (score >= NSFW_THRESHOLD) {
                    Log.w(TAG, "NSFW detected (confidence=$score)")
                    handleNsfwDetection(score)
                }
            }
        }
    }

    private fun captureFrame(width: Int, height: Int): Bitmap? {
        return try {
            val image = imageReader?.acquireLatestImage() ?: return null
            val plane  = image.planes[0]
            val buf    = plane.buffer
            val pixelStride  = plane.pixelStride
            val rowStride    = plane.rowStride
            val rowPadding   = rowStride - pixelStride * width

            val bitmap = Bitmap.createBitmap(
                width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buf)
            image.close()
            // Crop to exact screen dimensions
            Bitmap.createBitmap(bitmap, 0, 0, width, height)
        } catch (e: Exception) {
            Log.w(TAG, "Frame capture failed: ${e.message}")
            null
        }
    }

    // ── NSFW handling ─────────────────────────────────────────────────────────

    private fun handleNsfwDetection(confidence: Float) {
        // 1. Show full-screen block overlay immediately
        val overlayIntent = Intent(this, BlockOverlayActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        }
        startActivity(overlayIntent)

        // 2. Report to server (async, best-effort)
        scope.launch {
            try {
                val app      = application as PornBlockApplication
                val storage  = app.secureStorage
                val deviceId = storage.getDeviceId() ?: return@launch
                val api      = ApiClient.getService(storage)

                api.reportViolation(
                    ViolationRequest(
                        deviceId      = deviceId,
                        violationType = "nsfw_screen",
                        url           = null,
                        details       = ViolationDetails(
                            confidenceScore = confidence,
                            screenshotHash  = null,  // never send the actual image
                            source          = "screen_monitor",
                        ),
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to report violation: ${e.message}")
            }
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_screen),
            NotificationManager.IMPORTANCE_MIN,
        ).apply {
            description = getString(R.string.notification_channel_screen_desc)
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
            .setContentTitle(getString(R.string.notification_screen_title))
            .setContentText(getString(R.string.notification_screen_text))
            .setSmallIcon(R.drawable.ic_shield)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(tapIntent)
            .build()
    }

    companion object {
        const val ACTION_STOP        = "app.pornblock.SCREEN_STOP"
        const val EXTRA_RESULT_CODE  = "result_code"
        const val EXTRA_DATA         = "data"

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, ScreenMonitorService::class.java).apply {
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_DATA, data)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, ScreenMonitorService::class.java).apply { action = ACTION_STOP }
            )
        }
    }
}
