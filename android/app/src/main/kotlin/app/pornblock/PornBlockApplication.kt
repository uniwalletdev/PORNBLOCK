package app.pornblock

import android.app.Application
import androidx.work.Configuration
import androidx.work.WorkManager
import app.pornblock.network.ApiClient
import app.pornblock.storage.SecureStorage
import app.pornblock.workers.HeartbeatWorker

class PornBlockApplication : Application(), Configuration.Provider {

    lateinit var secureStorage: SecureStorage
        private set

    override fun onCreate() {
        super.onCreate()
        secureStorage = SecureStorage(this)
        // Eagerly build the Retrofit service once storage is ready.
        ApiClient.getService(secureStorage)
        // WorkManager is initialised via getWorkManagerConfiguration() below.
    }

    // ── WorkManager custom configuration ─────────────────────────────────────

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(HeartbeatWorker.Factory(secureStorage))
            .setMinimumLoggingLevel(
                if (BuildConfig.DEBUG) android.util.Log.DEBUG else android.util.Log.ERROR
            )
            .build()
}
