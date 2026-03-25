package app.pornblock.network

import app.pornblock.BuildConfig
import app.pornblock.storage.SecureStorage
import okhttp3.CertificatePinner
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    /**
     * Certificate pins for api.pornblock.app.
     * Replace these with real SHA-256 pins before release:
     *   openssl s_client -connect api.pornblock.app:443 | openssl x509 -pubkey -noout |
     *   openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64
     */
    private val CERT_PINS = listOf(
        "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", // leaf
        "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=", // intermediate
    )

    private var _service: ApiService? = null

    /** Build (or return cached) Retrofit service. */
    fun getService(storage: SecureStorage): ApiService {
        _service?.let { return it }

        val pinner = CertificatePinner.Builder().apply {
            CERT_PINS.forEach { add(BuildConfig.API_HOST, it) }
        }.build()

        val tokenInterceptor = Interceptor { chain ->
            val token = storage.getDeviceToken()
            val request = if (token != null) {
                chain.request().newBuilder()
                    .addHeader("X-Device-Token", token)
                    .build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG)
                HttpLoggingInterceptor.Level.BODY
            else
                HttpLoggingInterceptor.Level.NONE
        }

        val okHttp = OkHttpClient.Builder()
            .certificatePinner(pinner)
            .addInterceptor(tokenInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        return retrofit.create(ApiService::class.java).also { _service = it }
    }

    /** Clear cached instance (e.g. after token change). */
    fun invalidate() {
        _service = null
    }
}
