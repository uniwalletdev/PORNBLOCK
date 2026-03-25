package app.pornblock.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import app.pornblock.MainActivity
import app.pornblock.PornBlockApplication
import app.pornblock.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.FileInputStream
import java.io.FileOutputStream

private const val TAG                   = "PornBlockVpnService"
private const val NOTIFICATION_ID       = 1001
private const val CHANNEL_ID            = "vpn_channel"
private const val VPN_ADDRESS           = "10.8.0.1"
private const val VPN_PREFIX_LEN        = 24
private const val FAKE_DNS_ADDRESS      = "10.8.0.2"

/**
 * DNS-only VPN tunnel that intercepts all DNS queries routed through a
 * fake DNS server (10.8.0.2) and either returns NXDOMAIN (blocked) or
 * forwards to 1.1.1.1 (allowed).
 *
 * Only traffic destined for 10.8.0.2 is routed through the TUN interface;
 * all other traffic continues on the device's normal network path.
 */
class PornBlockVpnService : VpnService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var vpnInterface: ParcelFileDescriptor? = null
    private lateinit var processor: DnsPacketProcessor

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        val storage = (application as PornBlockApplication).secureStorage
        processor = DnsPacketProcessor(
            protect = { socket -> protect(socket) },
        ).also { proc ->
            // Initialise local lists from SecureStorage (best-effort; may be empty on first run)
            proc.updateBlocklist(storage.getCustomBlocklist().toSet())
            proc.updateAllowlist(storage.getCustomAllowlist().toSet())
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startVpn()
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        vpnInterface?.close()
        vpnInterface = null
        super.onDestroy()
    }

    override fun onRevoke() {
        // VPN was revoked by the user or system — try to restart via BootReceiver logic
        Log.w(TAG, "VPN revoked — stopping")
        stopSelf()
    }

    // ── VPN setup ─────────────────────────────────────────────────────────────

    private fun startVpn() {
        if (vpnInterface != null) return  // already running

        val configIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        vpnInterface = Builder()
            .addAddress(VPN_ADDRESS, VPN_PREFIX_LEN)
            .addRoute(FAKE_DNS_ADDRESS, 32)   // Only route our fake DNS through the tunnel
            .addDnsServer(FAKE_DNS_ADDRESS)   // Tell Android to query our fake DNS
            .setSession(getString(R.string.app_name))
            .setConfigureIntent(configIntent)
            .setBlocking(false)               // Non-blocking so we can use coroutines
            .also {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    it.setMetered(false)
                }
            }
            .establish()

        if (vpnInterface == null) {
            Log.e(TAG, "Failed to establish VPN interface")
            stopSelf()
            return
        }

        Log.i(TAG, "VPN interface established — DNS → $FAKE_DNS_ADDRESS intercepted")
        startPacketLoop()
    }

    // ── Packet processing loop ────────────────────────────────────────────────

    private fun startPacketLoop() {
        val fd = vpnInterface?.fileDescriptor ?: return

        scope.launch {
            val inputStream  = FileInputStream(fd)
            val outputStream = FileOutputStream(fd)
            val buffer       = ByteArray(32_767)

            while (isActive) {
                try {
                    val length = inputStream.read(buffer)
                    if (length <= 0) continue

                    val response = processor.process(buffer, length)
                    if (response != null) {
                        outputStream.write(response)
                    }
                } catch (e: Exception) {
                    if (isActive) Log.w(TAG, "Packet loop error: ${e.message}")
                }
            }
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_vpn),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = getString(R.string.notification_channel_vpn_desc) }

        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, PornBlockVpnService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_vpn_title))
            .setContentText(getString(R.string.notification_vpn_text))
            .setSmallIcon(R.drawable.ic_shield)
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, getString(R.string.action_vpn_stop), stopIntent)
            .build()
    }

    companion object {
        const val ACTION_STOP = "app.pornblock.VPN_STOP"

        fun start(context: Context) {
            val intent = Intent(context, PornBlockVpnService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, PornBlockVpnService::class.java)
                .apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }
}
