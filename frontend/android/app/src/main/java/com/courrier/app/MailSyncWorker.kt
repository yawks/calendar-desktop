package com.courrier.app

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
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
            val state = applicationContext.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            val initialized = state.contains(accountId)
            val detection = NativeMailClient().detect(account, state.getString(accountId, null))
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

    companion object {
        private const val TAG = "CourrierSync"
    }
}
