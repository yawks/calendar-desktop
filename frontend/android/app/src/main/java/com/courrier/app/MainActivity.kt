package com.courrier.app

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        registerPlugin(CourrierNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        val accountIds = SyncVault(applicationContext).accountIds()
        val vault = SyncVault(applicationContext)
        accountIds.forEach {
            when (vault.get(it)?.effectiveSyncMode()) {
                "periodic" -> SyncScheduler.enable(applicationContext, it)
                "continuous" -> SyncScheduler.enable(applicationContext, it, 60)
                else -> SyncScheduler.cancelWork(applicationContext, it)
            }
            if (vault.get(it)?.effectiveSyncMode() == "manual") SyncScheduler.runNow(applicationContext, it)
        }
        ContinuousSyncService.reconcile(applicationContext)
        val preferences = getSharedPreferences("native_sync_preferences", MODE_PRIVATE)
        if (preferences.getInt("notificationMigrationVersion", 0) < 3) {
            preferences.edit().putInt("notificationMigrationVersion", 3).apply()
            accountIds.forEach { SyncScheduler.runNow(applicationContext, it) }
        }
        runNotificationDiagnostic(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        runNotificationDiagnostic(intent)
    }

    private fun runNotificationDiagnostic(intent: Intent?) {
        if (!BuildConfig.DEBUG || intent?.action != DEBUG_NOTIFICATIONS_ACTION) return
        SyncVault(applicationContext).accountIds().forEach {
            SyncScheduler.runNotificationDiagnostic(applicationContext, it)
        }
    }

    companion object {
        private const val DEBUG_NOTIFICATIONS_ACTION = "com.courrier.app.DEBUG_NOTIFICATIONS"
    }
}
