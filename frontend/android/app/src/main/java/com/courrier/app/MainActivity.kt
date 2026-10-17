package com.courrier.app

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.content.res.Configuration
import android.graphics.Color
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    val sharedIntents = java.util.concurrent.ConcurrentLinkedQueue<Intent>()
    private var notificationLoadingView: View? = null
    private var notificationReceivedAt: Long? = null
    private var notificationLoaderShownAt: Long? = null
    private val notificationRevealFallback = Runnable { revealNotificationView("timeout") }
    override fun onCreate(savedInstanceState: Bundle?) {
        retainShare(intent)
        recordNotificationReceived(intent)
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
        retainShare(intent)
        recordNotificationReceived(intent)
        coverNotificationView(intent)
        super.onNewIntent(intent)
        setIntent(intent)
        runNotificationDiagnostic(intent)
        bridge.triggerWindowJSEvent("courrier:share-ready")
    }

    private fun retainShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND && intent?.action != Intent.ACTION_SEND_MULTIPLE) return
        sharedIntents.add(Intent(intent))
        intent?.action = Intent.ACTION_MAIN
    }

    private fun recordNotificationReceived(intent: Intent?) {
        if (intent?.dataString?.startsWith("courrier://mail/") != true) return
        notificationReceivedAt = SystemClock.elapsedRealtime()
        Log.i("CourrierUi", "event=notification-native-received")
    }

    private fun coverNotificationView(intent: Intent?) {
        if (intent?.dataString?.startsWith("courrier://mail/") != true) return
        // React's notification handler lives behind the vault screen. Keep
        // unlock accessible and retain the intent until the vault is unlocked.
        if (getSharedPreferences("native_sync_preferences", MODE_PRIVATE).getBoolean("vaultLocked", true)) {
            revealNotificationView("vault-locked")
            return
        }
        if (notificationLoadingView == null) {
            notificationLoadingView = layoutInflater.inflate(R.layout.notification_loading, null)
            addContentView(notificationLoadingView, ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            notificationLoaderShownAt = SystemClock.elapsedRealtime()
            Log.i("CourrierUi", "event=notification-native-loader-shown")
        }
        // The opaque loader covers the old screen while the WebView keeps
        // painting the React preview underneath it.
        // Match React's opening timeout; five seconds can expire before its
        // preview paints and expose the previous conversation on a slow resume.
        bridge.webView.removeCallbacks(notificationRevealFallback)
        bridge.webView.postDelayed(notificationRevealFallback, 60_000)
    }

    fun revealNotificationView(reason: String = "react") {
        runOnUiThread {
            val now = SystemClock.elapsedRealtime()
            notificationLoaderShownAt?.let {
                Log.i("CourrierUi", "event=notification-native-loader-hidden reason=$reason durationMs=${now - it}")
            }
            notificationLoaderShownAt = null
            if (reason == "react") {
                notificationReceivedAt?.let {
                    Log.i("CourrierUi", "event=notification-native-react-handoff durationMs=${now - it}")
                }
                notificationReceivedAt = null
            }
            bridge.webView.removeCallbacks(notificationRevealFallback)
            bridge.webView.alpha = 1f
            notificationLoadingView?.let { (it.parent as? ViewGroup)?.removeView(it) }
            notificationLoadingView = null
        }
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
