package com.courrier.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

class NativeNotifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)
    private val preferences = context.getSharedPreferences("native_sync_preferences", Context.MODE_PRIVATE)

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_mail), NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
    }

    fun notify(account: SyncAccount, messages: List<NewMessage>) {
        if (!preferences.getBoolean("notificationsEnabled", true)) {
            Log.i(TAG, "Notification skipped: disabled by user")
            return
        }
        migrateLegacyNotifications(account.id)
        val active = notificationMap(account.id)
        val conversations = messages.groupBy(NewMessage::conversationId).mapValues { it.value.last() }
        val changed = conversations.filter { (conversationId, message) -> active[conversationId] != message.id }
        if (changed.isEmpty()) {
            Log.i(TAG, "Notification update skipped: no new message for account=${account.id}")
            return
        }
        Log.i(TAG, "Posting ${changed.size} conversation notification(s) for account=${account.id}")
        val details = notificationDetails(account.id)
        changed.forEach { (conversationId, message) ->
            val notificationId = notificationId(account.id, conversationId)
            val contentIntent = mailIntent(account.id, conversationId, null, notificationId)
            val sender = message.sender.ifBlank { account.email }
            val text = message.snippet.ifBlank { message.subject.ifBlank { context.getString(R.string.notification_new_mail) } }
            val builder = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier_notification)
                .setContentTitle(sender)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(contentIntent)
                .setDeleteIntent(dismissIntent(account.id, conversationId, notificationId * 10 + 4))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setSortKey(message.id)
                .addAction(0, context.getString(R.string.notification_action_reply), mailIntent(account.id, conversationId, "reply", notificationId * 10 + 1))
                .addAction(0, context.getString(R.string.notification_action_delete), actionIntent(account.id, message.id, conversationId, "delete", notificationId * 10 + 2))
                .addAction(0, context.getString(R.string.notification_action_archive), actionIntent(account.id, message.id, conversationId, "archive", notificationId * 10 + 3))
            manager.notify(notificationId, builder.build())
            active[conversationId] = message.id
            details.put(conversationId, JSONObject()
                .put("sender", sender)
                .put("subject", message.subject)
                .put("snippet", text))
        }
        saveNotificationMap(account.id, active)
        saveNotificationDetails(account.id, details)
    }

    fun reconcile(account: SyncAccount, currentMessages: List<NewMessage>) {
        migrateLegacyNotifications(account.id)
        val active = notificationMap(account.id)
        val details = notificationDetails(account.id)
        // The delete intent already removes user-dismissed cards from our map.
        // Do not infer dismissal from activeNotifications: Android may briefly
        // omit a freshly posted card, which caused cancel/repost/vibration loops.
        val unreadConversations = currentMessages.map(NewMessage::conversationId).toSet()
        val removed = active.keys.filterNot(unreadConversations::contains)
        removed.forEach { conversationId ->
            manager.cancel(notificationId(account.id, conversationId))
            active.remove(conversationId)
            details.remove(conversationId)
        }
        if (removed.isNotEmpty()) {
            Log.i(TAG, "Cancelled ${removed.size} stale notification(s) for account=${account.id}")
            saveNotificationMap(account.id, active)
            saveNotificationDetails(account.id, details)
        }
    }

    private fun notificationMap(accountId: String): MutableMap<String, String> {
        val json = JSONObject(preferences.getString("notificationConversations:$accountId", "{}") ?: "{}")
        return json.keys().asSequence().associateWith { json.optString(it) }.toMutableMap()
    }

    private fun saveNotificationMap(accountId: String, active: Map<String, String>) {
        preferences.edit().putString("notificationConversations:$accountId", JSONObject(active).toString()).apply()
    }

    private fun notificationDetails(accountId: String) =
        JSONObject(preferences.getString("notificationConversationDetails:$accountId", "{}") ?: "{}")

    private fun saveNotificationDetails(accountId: String, details: JSONObject) {
        preferences.edit().putString("notificationConversationDetails:$accountId", details.toString()).apply()
    }

    private fun mailIntent(accountId: String, conversationId: String, action: String?, requestCode: Int): PendingIntent {
        val uri = Uri.Builder()
            .scheme("courrier")
            .authority("mail")
            .appendPath("account")
            .appendPath(accountId)
            .appendPath("conversation")
            .appendPath(conversationId)
            .apply { if (action != null) appendQueryParameter("action", action) }
            .build()
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(uri)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun actionIntent(accountId: String, messageId: String, conversationId: String, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .putExtra(NotificationActionWorker.ACCOUNT_ID, accountId).putExtra(NotificationActionWorker.MESSAGE_ID, messageId)
            .putExtra(NotificationActionWorker.CONVERSATION_ID, conversationId).putExtra(NotificationActionWorker.ACTION, action)
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun dismissIntent(accountId: String, conversationId: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .putExtra(NotificationActionWorker.ACCOUNT_ID, accountId)
            .putExtra(NotificationActionWorker.CONVERSATION_ID, conversationId)
            .putExtra(NotificationActionWorker.ACTION, NotificationActionWorker.DISMISS)
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun cancelAccount(id: String) {
        migrateLegacyNotifications(id)
        notificationMap(id).keys.forEach { manager.cancel(notificationId(id, it)) }
        manager.cancel(("summary:" + id).hashCode())
        preferences.edit().remove("notificationConversations:$id").remove("notificationConversationDetails:$id").apply()
    }

    fun cancelConversation(accountId: String, conversationId: String) {
        val active = notificationMap(accountId)
        val details = notificationDetails(accountId)
        manager.cancel(notificationId(accountId, conversationId))
        active.remove(conversationId)
        details.remove(conversationId)
        saveNotificationMap(accountId, active)
        saveNotificationDetails(accountId, details)
    }

    fun threadMetadata(accountId: String, conversationId: String): JSONObject? {
        val detail = notificationDetails(accountId).optJSONObject(conversationId) ?: return null
        return JSONObject().put("subject", detail.optString("subject"))
            .put("sender", detail.optString("sender")).put("snippet", detail.optString("snippet"))
    }

    private fun migrateLegacyNotifications(accountId: String) {
        val legacyKey = "notificationMap:$accountId"
        val legacy = JSONObject(preferences.getString(legacyKey, "{}") ?: "{}")
        if (legacy.length() == 0 && !preferences.contains("notificationDetails:$accountId")) return
        legacy.keys().asSequence().forEach { manager.cancel(it.hashCode()) }
        manager.cancel(("summary:" + accountId).hashCode())
        preferences.edit().remove(legacyKey).remove("notificationDetails:$accountId").remove("notificationEmail:$accountId").commit()
    }

    companion object {
        const val CHANNEL = "courrier_new_mail"
        private const val TAG = "CourrierSync"
        internal fun notificationId(accountId: String, conversationId: String) = "$accountId:$conversationId".hashCode()
    }
}
