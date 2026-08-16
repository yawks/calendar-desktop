package com.courrier.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class NativeNotifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)
    private val preferences = context.getSharedPreferences("native_sync_preferences", 0)

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_mail), NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
    }

    fun notify(account: SyncAccount, messages: List<NewMessage>) {
        val group = "courrier.account." + account.id
        messages.forEach { message ->
            val contentIntent = mailIntent(account.id, message.conversationId, null, message.id.hashCode())
            val privacy = if (preferences.getBoolean("vaultLocked", true)) {
                preferences.getString("privacy", "generic")
            } else {
                "sender-subject"
            }
            val text = when (privacy) {
                "sender" -> message.sender
                "sender-subject" -> message.sender + " — " + message.subject
                else -> context.getString(R.string.notification_new_mail)
            }
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier)
                .setContentTitle(account.email)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setGroup(group)
                .addAction(0, context.getString(R.string.notification_action_reply), mailIntent(account.id, message.conversationId, "reply", message.id.hashCode() * 10 + 1))
                .addAction(0, context.getString(R.string.notification_action_delete), mailIntent(account.id, message.conversationId, "delete", message.id.hashCode() * 10 + 2))
                .addAction(0, context.getString(R.string.notification_action_archive), mailIntent(account.id, message.conversationId, "archive", message.id.hashCode() * 10 + 3))
                .build()
            manager.notify(message.id.hashCode(), notification)
        }
        manager.notify(
            ("summary:" + account.id).hashCode(),
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_courrier)
                .setContentTitle(account.email)
                .setContentText(context.resources.getQuantityString(R.plurals.notification_new_mail_count, messages.size, messages.size))
                .setGroup(group)
                .setGroupSummary(true)
                .build(),
        )
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
        val intent = Intent(context, MainActivity::class.java).setData(uri)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun cancelAccount(id: String) {
        manager.cancel(("summary:" + id).hashCode())
    }

    fun cancelConversation(id: String) {
        manager.cancel(id.hashCode())
    }

    companion object {
        const val CHANNEL = "courrier_new_mail"
    }
}
