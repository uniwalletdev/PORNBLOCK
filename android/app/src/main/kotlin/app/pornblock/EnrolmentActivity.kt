package app.pornblock

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import app.pornblock.databinding.ActivityEnrolmentBinding
import app.pornblock.network.ApiClient
import app.pornblock.network.EnrolmentResponse
import app.pornblock.screen.ScreenMonitorService
import app.pornblock.services.HeartbeatService
import app.pornblock.vpn.PornBlockVpnService
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class EnrolmentActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEnrolmentBinding
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var scanning = true

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEnrolmentBinding.inflate(layoutInflater)
        setContentView(binding.root)

        startQrScanner()
    }

    override fun onResume() {
        super.onResume()
        binding.barcodeView.resume()
    }

    override fun onPause() {
        super.onPause()
        binding.barcodeView.pause()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    // ── QR scanner ────────────────────────────────────────────────────────────

    private fun startQrScanner() {
        binding.barcodeView.decodeContinuous(object : BarcodeCallback {
            override fun barcodeResult(result: BarcodeResult) {
                if (!scanning) return
                scanning = false
                binding.barcodeView.pause()
                handleScanResult(result.text)
            }
        })
    }

    private fun handleScanResult(raw: String) {
        // Expect either a bare token (UUID) or a full URL ending with /<token>
        val token = extractToken(raw) ?: run {
            showError(getString(R.string.enrolment_invalid_qr))
            return
        }
        validateAndEnrol(token)
    }

    private fun extractToken(raw: String): String? {
        val uuidRegex = Regex(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            RegexOption.IGNORE_CASE,
        )
        return uuidRegex.find(raw)?.value
    }

    // ── Enrolment API call ────────────────────────────────────────────────────

    private fun validateAndEnrol(token: String) {
        binding.progressBar.visibility = View.VISIBLE
        binding.tvStatus.text = getString(R.string.enrolment_validating)

        scope.launch {
            try {
                val storage = (application as PornBlockApplication).secureStorage
                val api     = ApiClient.getService(storage)
                val resp    = withContext(Dispatchers.IO) { api.validateEnrolmentToken(token) }

                if (resp.isSuccessful && resp.body() != null) {
                    completeEnrolment(resp.body()!!, token, storage)
                } else if (resp.code() == 410) {
                    showError(getString(R.string.enrolment_token_used))
                } else if (resp.code() == 404) {
                    showError(getString(R.string.enrolment_token_invalid))
                } else {
                    showError(getString(R.string.enrolment_server_error, resp.code()))
                }
            } catch (e: Exception) {
                showError(getString(R.string.enrolment_network_error))
            }
        }
    }

    private fun completeEnrolment(
        response: EnrolmentResponse,
        token: String,
        storage: app.pornblock.storage.SecureStorage,
    ) {
        // Persist credentials and policy
        storage.saveDeviceToken(token)
        val deviceId = UUID.randomUUID().toString()
        storage.saveDeviceId(deviceId)
        storage.saveSensitivityLevel(response.policy.sensitivityLevel)
        storage.saveCustomBlocklist(response.policy.customBlocklist)
        storage.saveCustomAllowlist(response.policy.customAllowlist)

        // Start all protection services
        HeartbeatService.start(this)
        PornBlockVpnService.start(this)
        // ScreenMonitorService requires an Activity result; skip here and prompt from MainActivity

        binding.progressBar.visibility = View.GONE
        binding.tvStatus.text = getString(R.string.enrolment_success, response.deviceName)

        startActivity(Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    private fun showError(msg: String) {
        binding.progressBar.visibility = View.GONE
        binding.tvStatus.text = msg
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        // Allow scanning again after a short delay
        binding.barcodeView.postDelayed({
            scanning = true
            binding.barcodeView.resume()
        }, 2_000)
    }
}
