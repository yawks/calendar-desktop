package com.courrier.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class SyncRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        try {
            val vault = SyncVault(context)
            vault.accountIds().forEach { id ->
                when (vault.get(id)?.effectiveSyncMode()) {
                    "periodic" -> SyncScheduler.enable(context, id)
                    "continuous" -> SyncScheduler.enable(context, id, 60)
                    else -> SyncScheduler.cancelWork(context, id)
                }
            }
            ContinuousSyncService.reconcile(context)
            Log.i("CourrierSync", "Periodic sync schedule restored after ${intent.action}")
        } catch (error: Exception) {
            // The keystore may still be unavailable during early boot. WorkManager's
            // persisted jobs remain intact and MainActivity retries restoration.
            Log.w("CourrierSync", "Sync schedule restoration deferred", error)
        }
    }
}
