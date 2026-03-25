package app.pornblock.network

import app.pornblock.network.EnrolmentResponse
import app.pornblock.network.HeartbeatRequest
import app.pornblock.network.HeartbeatResponse
import app.pornblock.network.TamperAlertRequest
import app.pornblock.network.ViolationRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {

    /**
     * Validate an enrolment token and receive the policy + install instructions.
     * Called once during initial device setup.
     */
    @GET("enrol/{token}")
    suspend fun validateEnrolmentToken(
        @Path("token") token: String,
    ): Response<EnrolmentResponse>

    /**
     * Send a heartbeat with current device status (called every 60 s from HeartbeatService,
     * and every 15 min as a WorkManager fallback).
     *
     * Requires `X-Device-Token` header (injected by ApiClient interceptor).
     */
    @POST("heartbeat")
    suspend fun sendHeartbeat(
        @Body request: HeartbeatRequest,
    ): Response<HeartbeatResponse>

    /**
     * Report a NSFW detection or DNS block event.
     *
     * Requires `X-Device-Token` header.
     */
    @POST("violation")
    suspend fun reportViolation(
        @Body request: ViolationRequest,
    ): Response<Unit>

    /**
     * Alert the accountability server that a tamper event was detected
     * (e.g. Device Admin disable requested or app uninstall attempted).
     *
     * Requires `X-Device-Token` header.
     */
    @POST("heartbeat/tamper")
    suspend fun reportTamper(
        @Body request: TamperAlertRequest,
    ): Response<Unit>
}
