package com.courrier.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class MailSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("accountId") ?: return Result.failure()
        return when (SyncEngine.syncAndReconcile(applicationContext, id, diagnostic = inputData.getBoolean(NOTIFICATION_DIAGNOSTIC, false))) {
            SyncResult.Success -> Result.success()
            SyncResult.RetryableFailure -> Result.retry()
            SyncResult.PermanentFailure -> Result.failure()
        }
    }

    companion object { const val NOTIFICATION_DIAGNOSTIC = "notificationDiagnostic" }
}
