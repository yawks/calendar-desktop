package com.courrier.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class MailSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val accountId = inputData.getString("accountId") ?: return Result.failure()
        val account = SyncVault(applicationContext).get(accountId) ?: return Result.success()
        return try {
            val state = applicationContext.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            val initialized = state.contains(accountId)
            val detection = StatelessMailClient().detect(account, state.getString(accountId, null))
            val seen = state.getStringSet("seen:" + accountId, emptySet())!!.toMutableSet()
            val fresh = if (initialized) detection.messages.filterNot { seen.contains(it.id) } else emptyList()
            detection.messages.forEach { seen.add(it.id) }
            while (seen.size > 500) seen.remove(seen.first())
            state.edit().putString(accountId, detection.cursor).putStringSet("seen:" + accountId, seen).apply()
            detection.credentialUpdate?.let { SyncVault(applicationContext).put(account.withCredentialUpdate(it)) }
            if (fresh.isNotEmpty()) NativeNotifier(applicationContext).notify(account, fresh)
            Result.success()
        } catch (_: IllegalArgumentException) {
            Result.failure()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
