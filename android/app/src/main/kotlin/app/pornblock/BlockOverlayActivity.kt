package app.pornblock

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import app.pornblock.databinding.ActivityBlockOverlayBinding

/**
 * Full-screen block overlay shown when NSFW content is detected.
 *
 * Launched with FLAG_ACTIVITY_NEW_TASK from ScreenMonitorService.
 * Auto-dismisses after AUTO_DISMISS_MS.
 * Back / home cannot be used to skip it (back is swallowed; home is handled by the OS
 * but the user then loses the content they were looking at).
 */
class BlockOverlayActivity : AppCompatActivity() {

    private lateinit var binding: ActivityBlockOverlayBinding
    private val handler = Handler(Looper.getMainLooper())
    private var countdown = AUTO_DISMISS_SECONDS

    private val countdownRunnable = object : Runnable {
        override fun run() {
            countdown--
            if (countdown <= 0) {
                finish()
            } else {
                binding.tvCountdown.text = getString(R.string.block_overlay_dismiss, countdown)
                handler.postDelayed(this, 1_000)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on and show over lock screen
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )

        binding = ActivityBlockOverlayBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.tvCountdown.text = getString(R.string.block_overlay_dismiss, countdown)
        handler.postDelayed(countdownRunnable, 1_000)
    }

    override fun onDestroy() {
        handler.removeCallbacks(countdownRunnable)
        super.onDestroy()
    }

    // Swallow back key so the user cannot dismiss the overlay manually
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) return true
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // intentionally swallowed
    }

    companion object {
        private const val AUTO_DISMISS_SECONDS = 5
    }
}
