package com.courrier.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ContinuousSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = mutableMapOf<String, Job>()
    private val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private lateinit var connectivity: ConnectivityManager
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { reconcileAccounts() }
        override fun onLost(network: Network) { jobs.values.forEach(Job::cancel); jobs.clear() }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        connectivity = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        connectivity.registerDefaultNetworkCallback(networkCallback)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        reconcileAccounts()
        return START_STICKY
    }

    private fun reconcileAccounts() = scope.launch {
        val vault = SyncVault(applicationContext)
        val continuous = vault.accountIds().filter { vault.get(it)?.effectiveSyncMode() == "continuous" }.toSet()
        if (continuous.isEmpty()) { stopSelf(); return@launch }
        startForeground(NOTIFICATION_ID, foregroundNotification(continuous.size))
        jobs.keys.filterNot(continuous::contains).forEach { jobs.remove(it)?.cancel() }
        continuous.forEach { id -> if (jobs[id]?.isActive != true) jobs[id] = launch { supervise(id) } }
    }

    private suspend fun supervise(id: String) {
        val delays = longArrayOf(5_000, 30_000, 120_000, 300_000, 900_000)
        var failures = 0
        while (currentCoroutineContext().isActive) {
            val account = SyncVault(applicationContext).get(id) ?: return
            if (account.effectiveSyncMode() != "continuous") return
            try {
                SyncStatusStore(applicationContext).state(id, "connecting")
                when (SyncEngine.syncAndReconcile(applicationContext, id, forceSnapshot = true)) {
                    SyncResult.PermanentFailure -> { SyncStatusStore(applicationContext).state(id, "authentication-error"); return }
                    SyncResult.RetryableFailure -> error("initial_sync_failed")
                    SyncResult.Success -> Unit
                }
                // The initial sync may have refreshed OAuth credentials. Always
                // listen with the freshly persisted account instead of the stale
                // access token loaded before synchronization.
                val listeningAccount = SyncVault(applicationContext).get(id) ?: return
                SyncStatusStore(applicationContext).state(id, "listening")
                if (listeningAccount.provider == "jmap") listenJmap(listeningAccount) else listenNative(listeningAccount)
                failures = 0
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: UnsupportedOperationException) {
                SyncStatusStore(applicationContext).state(id, "provider-unsupported")
                SyncScheduler.enable(applicationContext, id, 60)
                delay(60 * 60_000L)
            } catch (_: Exception) {
                SyncStatusStore(applicationContext).state(id, if (failures >= delays.lastIndex) "periodic-fallback" else "waiting-retry")
                if (failures >= delays.lastIndex) SyncScheduler.enable(applicationContext, id, 60)
                delay(delays[failures.coerceAtMost(delays.lastIndex)])
                failures++
            }
        }
    }

    private suspend fun listenJmap(account: SyncAccount) {
        val sessionUrl = account.credentials.optString("session_url")
        val token = account.credentials.optString("token").ifBlank { account.credentials.optString("fastmail_token") }
        if (sessionUrl.isBlank() || token.isBlank()) throw UnsupportedOperationException("jmap_push_credentials_missing")
        val sessionRequest = Request.Builder().url(sessionUrl).header("Authorization", "Bearer $token").build()
        val session = client.newCall(sessionRequest).execute().use { response ->
            if (!response.isSuccessful) error("jmap_session_failed")
            JSONObject(response.body?.string() ?: error("jmap_session_empty"))
        }
        var url = session.optString("eventSourceUrl")
        if (url.isBlank()) throw UnsupportedOperationException("jmap_push_unsupported")
        // A 30-second ping kept the radio and process unnecessarily active.
        // Five minutes is enough to detect a dead connection without defeating
        // Android's idle periods. Email state also covers moves/read changes, so
        // Mailbox events don't need to trigger notification reconciliation.
        url = url.replace("{types}", "Email").replace("{closeafter}", "no").replace("{ping}", "300")
        suspendCancellableCoroutine<Unit> { continuation ->
            val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
            val eventLock = Any()
            var pendingSync: Job? = null
            val source = EventSources.createFactory(client).newEventSource(request, object : EventSourceListener() {
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    if (!isEmailStateChange(type, data)) return
                    SyncStatusStore(applicationContext).event(account.id)
                    synchronized(eventLock) {
                        pendingSync?.cancel()
                        pendingSync = scope.launch {
                            delay(EVENT_DEBOUNCE_MS)
                            SyncStatusStore(applicationContext).state(account.id, "syncing")
                            SyncEngine.syncAndReconcile(applicationContext, account.id)
                            SyncStatusStore(applicationContext).state(account.id, "listening")
                        }
                    }
                }
                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(t ?: IllegalStateException("jmap_event_source_closed")))
                }
                override fun onClosed(eventSource: EventSource) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException("jmap_event_source_closed")))
                }
            })
            continuation.invokeOnCancellation {
                synchronized(eventLock) { pendingSync?.cancel() }
                source.cancel()
            }
        }
    }

    private suspend fun listenNative(account: SyncAccount) {
        while (currentCoroutineContext().isActive) {
            NativeCore.awaitEvent(account)
            SyncStatusStore(applicationContext).event(account.id)
            SyncStatusStore(applicationContext).state(account.id, "syncing")
            SyncEngine.syncAndReconcile(applicationContext, account.id, forceSnapshot = true)
            SyncStatusStore(applicationContext).state(account.id, "listening")
        }
    }

    private fun foregroundNotification(count: Int) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_courrier_notification).setOngoing(true).setOnlyAlertOnce(true)
        .setContentTitle(getString(R.string.sync_service_title))
        .setContentText(resources.getQuantityString(R.plurals.sync_service_accounts, count, count)).build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notification_channel_sync), NotificationManager.IMPORTANCE_LOW))
    }

    override fun onDestroy() {
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        scope.cancel()
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "courrier_sync"
        private const val NOTIFICATION_ID = 19042026
        private const val EVENT_DEBOUNCE_MS = 3_000L

        internal fun isEmailStateChange(type: String?, data: String): Boolean {
            if (type != null && type != "state") return false
            return runCatching {
                val changed = JSONObject(data).optJSONObject("changed") ?: return@runCatching false
                changed.keys().asSequence().any { accountId ->
                    changed.optJSONObject(accountId)?.has("Email") == true
                }
            }.getOrDefault(false)
        }

        fun reconcile(context: Context) {
            val vault = SyncVault(context)
            val hasContinuous = vault.accountIds().any { vault.get(it)?.effectiveSyncMode() == "continuous" }
            if (hasContinuous) ContextCompat.startForegroundService(context, Intent(context, ContinuousSyncService::class.java))
            else context.stopService(Intent(context, ContinuousSyncService::class.java))
        }
    }
}
