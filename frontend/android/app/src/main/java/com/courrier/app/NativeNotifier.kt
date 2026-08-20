package com.courrier.app

import android.app.NotificationChannel
import android.app.Notification
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
        Log.i(TAG, "Posting ${messages.size} notification(s) for account=${account.id}")
        val group = "courrier.account." + account.id
        val active = notificationMap(account.id)
        val details = notificationDetails(account.id)
        val grouped = (active.keys + messages.map { it.id }).distinct().size > 1
        messages.forEach { message ->
            val contentIntent = mailIntent(account.id, message.conversationId, null, message.id.hashCode())
            val sender = message.sender.ifBlank { account.email }
            val text = message.snippet.ifBlank { message.subject.ifBlank { context.getString(R.string.notification_new_mail) } }
            val builder = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier_notification)
                .setContentTitle(sender)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(contentIntent)
                .setDeleteIntent(dismissIntent(account.id, message.id, message.id.hashCode() * 10 + 4))
                .setAutoCancel(true)
                .setGroup(group)
                .setSortKey(message.id)
                .addAction(0, context.getString(R.string.notification_action_reply), mailIntent(account.id, message.conversationId, "reply", message.id.hashCode() * 10 + 1))
                .addAction(0, context.getString(R.string.notification_action_delete), actionIntent(account.id, message.id, message.conversationId, "delete", message.id.hashCode() * 10 + 2))
                .addAction(0, context.getString(R.string.notification_action_archive), actionIntent(account.id, message.id, message.conversationId, "archive", message.id.hashCode() * 10 + 3))
            if (grouped) builder.setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY)
            manager.notify(message.id.hashCode(), builder.build())
            active[message.id] = message.conversationId
            details.put(message.id, JSONObject()
                .put("sender", sender)
                .put("snippet", text))
        }
        saveNotificationMap(account.id, active)
        saveNotificationDetails(account.id, details)
        preferences.edit().putString("notificationEmail:${account.id}", account.email).apply()
        updateSummary(account.id, account.email, active.size)
    }

    fun reconcile(account: SyncAccount, currentMessageIds: Set<String>) {
        val active = notificationMap(account.id)
        val details = notificationDetails(account.id)
        val posted = (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
        val postedIds = posted.map { it.id }.toSet()
        // Migrate notifications created before sender/snippet persistence by
        // recovering their public rendering data directly from Android.
        posted.forEach { status ->
            val messageId = active.keys.firstOrNull { it.hashCode() == status.id } ?: return@forEach
            if (!details.has(messageId)) details.put(messageId, JSONObject()
                .put("sender", status.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty())
                .put("snippet", status.notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()))
        }
        val removed = active.keys.filter { messageId ->
            messageId !in currentMessageIds || messageId.hashCode() !in postedIds
        }
        removed.forEach { messageId ->
            manager.cancel(messageId.hashCode())
            active.remove(messageId)
            details.remove(messageId)
        }
        if (removed.isNotEmpty()) {
            Log.i(TAG, "Cancelled ${removed.size} stale notification(s) for account=${account.id}")
            saveNotificationMap(account.id, active)
        }
        saveNotificationDetails(account.id, details)
        // Re-post retained children so notifications created by an older app
        // version receive the current grouping and ACTION_VIEW pending intents.
        val grouped = active.size > 1
        active.forEach { (messageId, conversationId) ->
            val item = details.optJSONObject(messageId) ?: JSONObject()
            val sender = item.optString("sender").ifBlank { account.email }
            val text = item.optString("snippet").ifBlank { context.getString(R.string.notification_new_mail) }
            val builder = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier_notification)
                .setContentTitle(sender)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(mailIntent(account.id, conversationId, null, messageId.hashCode()))
                .setDeleteIntent(dismissIntent(account.id, messageId, messageId.hashCode() * 10 + 4))
                .setAutoCancel(true)
                .setGroup("courrier.account." + account.id)
                .setSortKey(messageId)
                .addAction(0, context.getString(R.string.notification_action_reply), mailIntent(account.id, conversationId, "reply", messageId.hashCode() * 10 + 1))
                .addAction(0, context.getString(R.string.notification_action_delete), actionIntent(account.id, messageId, conversationId, "delete", messageId.hashCode() * 10 + 2))
                .addAction(0, context.getString(R.string.notification_action_archive), actionIntent(account.id, messageId, conversationId, "archive", messageId.hashCode() * 10 + 3))
            if (grouped) builder.setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY).setOnlyAlertOnce(true)
            manager.notify(messageId.hashCode(), builder.build())
        }
        // Re-apply the one-vs-many presentation even when the unread set did not
        // change (for example after upgrading from an older notification layout).
        updateSummary(account.id, account.email, active.size)
    }

    private fun updateSummary(accountId: String, email: String, count: Int) {
        val summaryId = ("summary:" + accountId).hashCode()
        // A group summary for one child replaces the useful sender/snippet card
        // with "1 new email" on some Android variants. Keep the child standalone.
        if (count <= 1) {
            manager.cancel(summaryId)
            return
        }
        val style = NotificationCompat.InboxStyle()
            .setBigContentTitle(context.resources.getQuantityString(R.plurals.notification_new_mail_count, count, count))
        val details = notificationDetails(accountId)
        details.keys().asSequence().take(6).forEach { messageId ->
            val item = details.optJSONObject(messageId) ?: return@forEach
            style.addLine("${item.optString("sender")} — ${item.optString("snippet")}")
        }
        manager.notify(
            summaryId,
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier_notification)
                .setContentTitle(context.resources.getQuantityString(R.plurals.notification_new_mail_count, count, count))
                .setContentText(email)
                .setStyle(style)
                .setGroup("courrier.account." + accountId)
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY)
                .setOnlyAlertOnce(true)
                .build(),
        )
    }

    private fun notificationMap(accountId: String): MutableMap<String, String> {
        val json = JSONObject(preferences.getString("notificationMap:$accountId", "{}") ?: "{}")
        return json.keys().asSequence().associateWith { json.optString(it) }.toMutableMap()
    }

    private fun saveNotificationMap(accountId: String, active: Map<String, String>) {
        preferences.edit().putString("notificationMap:$accountId", JSONObject(active).toString()).apply()
    }

    private fun notificationDetails(accountId: String) =
        JSONObject(preferences.getString("notificationDetails:$accountId", "{}") ?: "{}")

    private fun saveNotificationDetails(accountId: String, details: JSONObject) {
        preferences.edit().putString("notificationDetails:$accountId", details.toString()).apply()
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

    private fun dismissIntent(accountId: String, messageId: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .putExtra(NotificationActionWorker.ACCOUNT_ID, accountId)
            .putExtra(NotificationActionWorker.MESSAGE_ID, messageId)
            .putExtra(NotificationActionWorker.ACTION, NotificationActionWorker.DISMISS)
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun cancelAccount(id: String) {
        notificationMap(id).keys.forEach { manager.cancel(it.hashCode()) }
        manager.cancel(("summary:" + id).hashCode())
        preferences.edit().remove("notificationMap:$id").remove("notificationDetails:$id").remove("notificationEmail:$id").apply()
    }

    fun cancelConversation(accountId: String, conversationId: String) {
        val active = notificationMap(accountId)
        val details = notificationDetails(accountId)
        active.filterValues { it == conversationId }.keys.toList().forEach { messageId ->
            manager.cancel(messageId.hashCode())
            active.remove(messageId)
            details.remove(messageId)
        }
        saveNotificationMap(accountId, active)
        saveNotificationDetails(accountId, details)
        updateSummary(accountId, preferences.getString("notificationEmail:$accountId", accountId) ?: accountId, active.size)
    }

    fun cancelMessage(accountId: String, messageId: String) {
        val active = notificationMap(accountId)
        val details = notificationDetails(accountId)
        manager.cancel(messageId.hashCode())
        active.remove(messageId)
        details.remove(messageId)
        saveNotificationMap(accountId, active)
        saveNotificationDetails(accountId, details)
        updateSummary(accountId, preferences.getString("notificationEmail:$accountId", accountId) ?: accountId, active.size)
    }

    companion object {
        const val CHANNEL = "courrier_new_mail"
        private const val TAG = "CourrierSync"
    }
}
