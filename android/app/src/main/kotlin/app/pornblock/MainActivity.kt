package app.pornblock

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import app.pornblock.admin.AdminReceiver
import app.pornblock.databinding.ActivityMainBinding
import app.pornblock.screen.ScreenMonitorService
import app.pornblock.services.HeartbeatService
import app.pornblock.vpn.PornBlockVpnService
import androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.pornblock.workers.HeartbeatWorker
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var storage: app.pornblock.storage.SecureStorage

    private val vpnPermissionLauncher = registerForActivityResult(StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            PornBlockVpnService.start(this)
            refreshStatus()
        } else {
            Toast.makeText(this, getString(R.string.vpn_permission_denied), Toast.LENGTH_SHORT).show()
        }
    }

    private val screenCaptureLauncher = registerForActivityResult(StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            storage.saveProjectionResultCode(result.resultCode)
            ScreenMonitorService.start(this, result.resultCode, result.data!!)
            refreshStatus()
        } else {
            Toast.makeText(this, getString(R.string.screen_permission_denied), Toast.LENGTH_SHORT).show()
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        storage = (application as PornBlockApplication).secureStorage

        if (!storage.isEnrolled()) {
            startActivity(Intent(this, EnrolmentActivity::class.java))
            finish()
            return
        }

        setupUi()
        ensureServicesRunning()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    // ── UI setup ──────────────────────────────────────────────────────────────

    private fun setupUi() {
        binding.btnEnableVpn.setOnClickListener { requestVpnPermission() }
        binding.btnEnableScreen.setOnClickListener { requestScreenCapturePermission() }
        binding.btnSupport.setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(getString(R.string.support_url))))
        }
        binding.btnActivateAdmin.setOnClickListener { requestDeviceAdmin() }
    }

    private fun refreshStatus() {
        val vpnActive    = isVpnActive()
        val screenActive = isServiceRunning(ScreenMonitorService::class.java)
        val adminActive  = isDeviceAdminActive()

        binding.statusBadge.text = if (vpnActive && screenActive)
            getString(R.string.status_protected)
        else
            getString(R.string.status_partial)

        binding.statusBadge.setBackgroundResource(
            if (vpnActive && screenActive) R.drawable.bg_badge_success else R.drawable.bg_badge_warning
        )

        binding.tvVpnStatus.text = getString(
            if (vpnActive) R.string.vpn_status_active else R.string.vpn_status_inactive
        )
        binding.tvScreenStatus.text = getString(
            if (screenActive) R.string.screen_status_active else R.string.screen_status_inactive
        )

        binding.btnEnableVpn.visibility    = if (vpnActive)    View.GONE else View.VISIBLE
        binding.btnEnableScreen.visibility = if (screenActive) View.GONE else View.VISIBLE
        binding.btnActivateAdmin.visibility = if (adminActive) View.GONE else View.VISIBLE
    }

    // ── Permission flows ──────────────────────────────────────────────────────

    private fun requestVpnPermission() {
        val intent = VpnService.prepare(this)
        if (intent == null) {
            PornBlockVpnService.start(this)
            refreshStatus()
        } else {
            vpnPermissionLauncher.launch(intent)
        }
    }

    private fun requestScreenCapturePermission() {
        val projManager = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        screenCaptureLauncher.launch(projManager.createScreenCaptureIntent())
    }

    private fun requestDeviceAdmin() {
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, AdminReceiver.getComponentName(this@MainActivity))
            putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.admin_rationale))
        }
        startActivity(intent)
    }

    // ── Service helpers ───────────────────────────────────────────────────────

    private fun ensureServicesRunning() {
        HeartbeatService.start(this)

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "heartbeat_backup",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES).build()
        )

        if (isVpnActive().not()) requestVpnPermission()
    }

    private fun isVpnActive(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        return cm.allNetworks.any { network ->
            cm.getNetworkCapabilities(network)
                ?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) == true
        }
    }

    @Suppress("DEPRECATION")
    private fun <T> isServiceRunning(serviceClass: Class<T>): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.getRunningServices(Int.MAX_VALUE).any {
            it.service.className == serviceClass.name
        }
    }

    private fun isDeviceAdminActive(): Boolean {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isAdminActive(AdminReceiver.getComponentName(this))
    }
}
