package com.courrier.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONArray

class MailSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val accountId = inputData.getString("accountId") ?: return Result.failure()
        val status = SyncStatusStore(applicationContext)
        status.started(accountId)
        Log.i(TAG, "Sync started for account=$accountId")
        val account = SyncVault(applicationContext).get(accountId)
        if (account == null) {
            Log.w(TAG, "Sync skipped: no encrypted account configuration for account=$accountId")
            status.failed(accountId, "missing_sync_configuration", retrying = false)
            return Result.success()
        }
        return try {
            awaitValidatedNetwork()
            val notificationDiagnostic = inputData.getBoolean(NOTIFICATION_DIAGNOSTIC, false)
            val state = applicationContext.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            val initialized = state.contains(accountId)
            val detection = detectWithWakeRetries(account, if (notificationDiagnostic) null else state.getString(accountId, null))
            if (notificationDiagnostic) {
                val messages = detection.messages.take(5)
                val notifier = NativeNotifier(applicationContext)
                notifier.cancelAccount(accountId)
                if (messages.isNotEmpty()) notifier.notify(account, messages)
                status.succeeded(accountId)
                Log.i(TAG, "Notification diagnostic completed account=$accountId posted=${messages.size}")
                return Result.success()
            }
            val currentMessageIds = JSONArray(detection.cursor).let { array ->
                (0 until array.length()).map { array.getString(it) }.toSet()
            }
            NativeNotifier(applicationContext).reconcile(account, currentMessageIds)
            val seen = state.getStringSet("seen:" + accountId, emptySet())!!.toMutableSet()
            val fresh = if (initialized) detection.messages.filterNot { seen.contains(it.id) } else emptyList()
            Log.i(TAG, "Sync response account=$accountId initialized=$initialized detected=${detection.messages.size} fresh=${fresh.size}")
            detection.messages.forEach { seen.add(it.id) }
            while (seen.size > 500) seen.remove(seen.first())
            state.edit().putString(accountId, detection.cursor).putStringSet("seen:" + accountId, seen).apply()
            detection.credentialUpdate?.let { SyncVault(applicationContext).put(account.withCredentialUpdate(it)) }
            if (fresh.isNotEmpty()) NativeNotifier(applicationContext).notify(account, fresh)
            status.succeeded(accountId)
            Log.i(TAG, "Sync completed for account=$accountId")
            Result.success()
        } catch (error: CancellationException) {
            status.failed(accountId, "worker_cancelled", retrying = true)
            throw error
        } catch (error: Exception) {
            val code = SyncFailureClassifier.code(error)
            val retrying = SyncFailureClassifier.isRetryable(code)
            status.failed(accountId, code, retrying)
            Log.e(TAG, "Sync failure account=$accountId code=$code retrying=$retrying", error)
            if (retrying) Result.retry() else Result.failure()
        }
    }

    private suspend fun awaitValidatedNetwork() {
        val manager = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        repeat(15) {
            val network = manager.activeNetwork
            val capabilities = network?.let(manager::getNetworkCapabilities)
            if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true) return
            delay(2_000)
        }
        Log.w(TAG, "Network was not validated after 30s; attempting sync anyway")
    }

    private suspend fun detectWithWakeRetries(account: SyncAccount, cursor: String?): DetectionResult {
        var lastError: Exception? = null
        repeat(3) { attempt ->
            try {
                return NativeMailClient().detect(account, cursor)
            } catch (error: Exception) {
                val code = SyncFailureClassifier.code(error)
                if (code != "provider_request_failed" || attempt == 2) throw error
                lastError = error
                val delayMs = if (attempt == 0) 5_000L else 15_000L
                Log.w(TAG, "Provider unavailable after network wake; retry=${attempt + 1} delay=${delayMs}ms")
                delay(delayMs)
            }
        }
        throw lastError ?: IllegalStateException("provider_request_failed")
    }

    companion object {
        private const val TAG = "CourrierSync"
        const val NOTIFICATION_DIAGNOSTIC = "notificationDiagnostic"
    }
}
