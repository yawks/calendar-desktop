package com.courrier.app

import android.content.Intent
import android.os.Bundle
import android.content.res.Configuration
import android.graphics.Color
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        registerPlugin(CourrierNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        val darkMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        bridge.webView.setBackgroundColor(Color.parseColor(if (darkMode) "#1c1e20" else "#ffffff"))
        coverNotificationView(intent)
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
        if (preferences.getInt("notificationMigrationVersion", 0) < 6) {
            preferences.edit().putInt("notificationMigrationVersion", 6).apply()
            accountIds.forEach {
                NativeNotifier(applicationContext).cancelAccount(it)
                SyncScheduler.runNow(applicationContext, it)
            }
        }
        runNotificationDiagnostic(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        coverNotificationView(intent)
        runNotificationDiagnostic(intent)
    }

    private fun coverNotificationView(intent: Intent?) {
        if (intent?.dataString?.startsWith("courrier://mail/") != true) return
        bridge.webView.alpha = 0f
        // Never leave the app hidden if JavaScript initialization fails.
        bridge.webView.postDelayed({ revealNotificationView() }, 5_000)
    }

    fun revealNotificationView() {
        runOnUiThread { bridge.webView.alpha = 1f }
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
