package com.courrier.app

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

object SyncScheduler {
    internal fun workName(id: String) = "courrier-periodic-sync-" + id.hashCode()
    private fun legacyWorkName(id: String, slot: Int) = "courrier-sync-" + id.hashCode() + "-$slot"

    fun enable(context: Context, id: String, intervalOverride: Int? = null) {
        val manager = WorkManager.getInstance(context)
        // Remove work created by versions that chained two one-shot requests.
        manager.cancelUniqueWork(legacyWorkName(id, 0))
        manager.cancelUniqueWork(legacyWorkName(id, 1))
        val interval = intervalOverride ?: SyncVault(context).get(id)?.syncIntervalMinutes?.coerceIn(15, 60) ?: 15
        val request = PeriodicWorkRequestBuilder<MailSyncWorker>(interval.toLong(), TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("accountId" to id))
            .build()
        Log.i("CourrierSync", "Scheduling periodic sync account=$id interval=${interval}m")
        manager.enqueueUniquePeriodicWork(workName(id), ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun runNow(context: Context, id: String) {
        val request = OneTimeWorkRequestBuilder<MailSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("accountId" to id))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "${workName(id)}-manual",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun runRecovery(context: Context, id: String) {
        val request = OneTimeWorkRequestBuilder<MailSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("accountId" to id))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "${workName(id)}-network-recovery",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun runNotificationDiagnostic(context: Context, id: String) {
        val request = OneTimeWorkRequestBuilder<MailSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("accountId" to id, MailSyncWorker.NOTIFICATION_DIAGNOSTIC to true))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "${workName(id)}-notification-diagnostic",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun disable(context: Context, id: String) {
        cancelWork(context, id)
        SyncVault(context).delete(id)
        SyncStatusStore(context).delete(id)
        context.getSharedPreferences("native_sync_state", Context.MODE_PRIVATE)
            .edit().remove(id).remove("seen:$id").apply()
        NativeNotifier(context).cancelAccount(id)
    }

    fun cancelWork(context: Context, id: String) {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork(workName(id))
        manager.cancelUniqueWork("${workName(id)}-manual")
        manager.cancelUniqueWork("${workName(id)}-network-recovery")
        manager.cancelUniqueWork("${workName(id)}-notification-diagnostic")
        manager.cancelUniqueWork(legacyWorkName(id, 0))
        manager.cancelUniqueWork(legacyWorkName(id, 1))
    }
}
