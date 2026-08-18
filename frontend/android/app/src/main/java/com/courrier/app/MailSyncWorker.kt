package com.courrier.app

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray

class MailSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val accountId = inputData.getString("accountId") ?: return Result.failure()
        val scheduleSlot = inputData.getInt("scheduleSlot", 0)
        Log.i(TAG, "Sync started for account=$accountId")
        val account = SyncVault(applicationContext).get(accountId)
        if (account == null) {
            Log.w(TAG, "Sync skipped: no encrypted account configuration for account=$accountId")
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
            Log.i(TAG, "Sync completed for account=$accountId")
            SyncScheduler.scheduleNext(applicationContext, accountId, scheduleSlot)
            Result.success()
        } catch (error: IllegalArgumentException) {
            Log.e(TAG, "Permanent sync failure for account=$accountId: ${error.message}", error)
            SyncScheduler.scheduleNext(applicationContext, accountId, scheduleSlot)
            Result.failure()
        } catch (error: Exception) {
            Log.e(TAG, "Temporary sync failure for account=$accountId: ${error.message}", error)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "CourrierSync"
    }
}
