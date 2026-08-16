package com.courrier.app

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

object SyncScheduler {
    internal fun workName(id: String) = workName(id, 0)
    private fun workName(id: String, slot: Int) = "courrier-sync-" + id.hashCode() + "-$slot"

    fun enable(context: Context, id: String) {
        WorkManager.getInstance(context).cancelUniqueWork(workName(id, 1))
        schedule(context, id, slot = 0, delayMinutes = 0, ExistingWorkPolicy.REPLACE)
    }

    fun scheduleNext(context: Context, id: String, currentSlot: Int) {
        val interval = SyncVault(context).get(id)?.syncIntervalMinutes?.coerceIn(5, 60) ?: 15
        val nextSlot = if (currentSlot == 0) 1 else 0
        schedule(context, id, nextSlot, interval.toLong(), ExistingWorkPolicy.REPLACE)
    }

    private fun schedule(
        context: Context,
        id: String,
        slot: Int,
        delayMinutes: Long,
        policy: ExistingWorkPolicy,
    ) {
        val request = OneTimeWorkRequestBuilder<MailSyncWorker>()
            .setInitialDelay(delayMinutes, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("accountId" to id, "scheduleSlot" to slot))
            .build()
        Log.i("CourrierSync", "Scheduling sync account=$id slot=$slot delay=${delayMinutes}m")
        WorkManager.getInstance(context).enqueueUniqueWork(workName(id, slot), policy, request)
    }

    fun disable(context: Context, id: String) {
        WorkManager.getInstance(context).cancelUniqueWork(workName(id, 0))
        WorkManager.getInstance(context).cancelUniqueWork(workName(id, 1))
        SyncVault(context).delete(id)
        context.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            .edit().remove(id).remove("seen:$id").apply()
        NativeNotifier(context).cancelAccount(id)
    }
}
