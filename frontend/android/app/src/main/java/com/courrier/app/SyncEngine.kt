package com.courrier.app

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Single synchronization path shared by periodic, continuous and manual triggers. */
object SyncEngine {
    private val locks = mutableMapOf<String, Mutex>()

    suspend fun syncAndReconcile(context: Context, accountId: String, forceSnapshot: Boolean = false, diagnostic: Boolean = false): SyncResult = lock(accountId).withLock {
        val status = SyncStatusStore(context)
        status.started(accountId)
        val account = SyncVault(context).get(accountId) ?: run {
            status.failed(accountId, "missing_sync_configuration", false)
            return@withLock SyncResult.PermanentFailure
        }
        try {
            val state = context.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            val initialized = state.contains(accountId)
            val detection = detectWithWakeRetries(account, if (forceSnapshot || diagnostic) null else state.getString(accountId, null))
            if (diagnostic) {
                NativeNotifier(context).also { it.cancelAccount(accountId); if (detection.messages.isNotEmpty()) it.notify(account, detection.messages.take(5)) }
                status.succeeded(accountId, account.syncIntervalMinutes)
                return@withLock SyncResult.Success
            }
            NativeNotifier(context).reconcile(account, detection.messages)
            val seen = state.getStringSet("seen:$accountId", emptySet())!!.toMutableSet()
            val fresh = if (initialized) detection.messages.filterNot { it.id in seen } else emptyList()
            detection.messages.forEach { seen.add(it.id) }
            while (seen.size > 500) seen.remove(seen.first())
            check(state.edit().putString(accountId, detection.cursor).putStringSet("seen:$accountId", seen).commit())
            detection.credentialUpdate?.let { SyncVault(context).updateCredentials(accountId, it) }
            if (fresh.isNotEmpty()) NativeNotifier(context).notify(account, fresh)
            status.succeeded(accountId, account.syncIntervalMinutes)
            SyncResult.Success
        } catch (cancelled: CancellationException) {
            status.failed(accountId, "sync_cancelled", true)
            throw cancelled
        } catch (error: Exception) {
            val code = SyncFailureClassifier.code(error)
            val retryable = SyncFailureClassifier.isRetryable(code)
            status.failed(accountId, code, retryable)
            // Provider errors may contain URLs or protocol diagnostics. Log only
            // the normalized code and opaque local account id, never the cause.
            Log.e("CourrierSync", "Sync failed account=$accountId code=$code")
            if (retryable) SyncResult.RetryableFailure else SyncResult.PermanentFailure
        }
    }

    private suspend fun detectWithWakeRetries(account: SyncAccount, cursor: String?): DetectionResult {
        repeat(3) { attempt ->
            try { return NativeMailClient().detect(account, cursor) }
            catch (error: Exception) {
                if (SyncFailureClassifier.code(error) != "provider_request_failed" || attempt == 2) throw error
                delay(if (attempt == 0) 5_000 else 15_000)
            }
        }
        error("provider_request_failed")
    }

    private fun lock(id: String) = synchronized(locks) { locks.getOrPut(id) { Mutex() } }
}

enum class SyncResult { Success, RetryableFailure, PermanentFailure }
