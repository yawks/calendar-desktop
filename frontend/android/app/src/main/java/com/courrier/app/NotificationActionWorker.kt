package com.courrier.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.work.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getStringExtra(NotificationActionWorker.ACTION) == NotificationActionWorker.DISMISS) {
            NativeNotifier(context).cancelConversation(
                intent.getStringExtra(NotificationActionWorker.ACCOUNT_ID) ?: return,
                intent.getStringExtra(NotificationActionWorker.CONVERSATION_ID) ?: return,
            )
            return
        }
        NativeNotifier(context).cancelConversation(
            intent.getStringExtra(NotificationActionWorker.ACCOUNT_ID) ?: return,
            intent.getStringExtra(NotificationActionWorker.CONVERSATION_ID) ?: return,
        )
        val data = Data.Builder()
        listOf(NotificationActionWorker.ACCOUNT_ID, NotificationActionWorker.MESSAGE_ID, NotificationActionWorker.CONVERSATION_ID, NotificationActionWorker.ACTION)
            .forEach { data.putString(it, intent.getStringExtra(it)) }
        WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<NotificationActionWorker>().setInputData(data.build()).build())
    }
}

class NotificationActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val accountId = inputData.getString(ACCOUNT_ID) ?: return Result.failure()
        val action = inputData.getString(ACTION) ?: return Result.failure()
        val messageId = inputData.getString(MESSAGE_ID) ?: return Result.failure()
        val conversationId = inputData.getString(CONVERSATION_ID) ?: return Result.failure()
        val account = SyncVault(applicationContext).get(accountId) ?: return Result.failure()
        return try {
            execute(account, messageId, conversationId, action)
            val label = if (action == "archive") R.string.notification_archived else R.string.notification_deleted
            Toast.makeText(applicationContext, applicationContext.getString(R.string.notification_action_done, applicationContext.getString(label)), Toast.LENGTH_LONG).show()
            Result.success()
        } catch (_: Exception) {
            Toast.makeText(applicationContext, R.string.notification_action_failed, Toast.LENGTH_LONG).show()
            Result.failure()
        }
    }

    private fun execute(account: SyncAccount, messageId: String, conversationId: String, action: String) {
        when (account.provider) {
            "gmail" -> gmail(account, messageId, action)
            "imap" -> {
                val parts = conversationId.split(":", limit = 2)
                val command = if (action == "archive") "imap_archive" else "imap_move_to_trash"
                NativeCore.command(command, JSONObject().put("config", account.credentials).put("folder", parts.getOrElse(0) { "INBOX" }).put("id", parts.getOrElse(1) { messageId }).toString())
            }
            "jmap" -> {
                val command = if (action == "delete") "jmap_bulk_move_to_trash" else "jmap_bulk_move_to_folder"
                val args = JSONObject().put("config", account.credentials).put("threadIds", JSONArray().put(conversationId))
                if (action == "archive") args.put("folderId", archiveFolder("jmap_list_folders", JSONObject().put("config", account.credentials)))
                NativeCore.command(command, args.toString())
            }
            "exchange" -> exchange(account, conversationId, action)
            else -> error("Unsupported provider")
        }
    }

    private fun gmail(account: SyncAccount, messageId: String, action: String) {
        val suffix = if (action == "delete") "/trash" else "/modify"
        val body = if (action == "delete") "{}" else "{\"removeLabelIds\":[\"INBOX\"]}"
        val request = Request.Builder().url("https://gmail.googleapis.com/gmail/v1/users/me/messages/$messageId$suffix")
            .header("Authorization", "Bearer ${account.credentials.getString("accessToken")}")
            .post(body.toRequestBody("application/json".toMediaType())).build()
        OkHttpClient().newCall(request).execute().use { if (!it.isSuccessful) error("Gmail ${it.code}") }
    }

    private fun exchange(account: SyncAccount, conversationId: String, action: String) {
        val token = account.credentials.getString("accessToken")
        val raw = NativeCore.command("mail_get_thread_headers", JSONObject().put("accessToken", token).put("conversationId", conversationId).put("includeTrash", false).put("isDraft", false).put("includeDrafts", false).toString())
        val headers = JSONArray(raw); val ids = JSONArray()
        for (i in 0 until headers.length()) ids.put(headers.getJSONObject(i).getString("item_id"))
        val args = JSONObject().put("accessToken", token).put("itemIds", ids)
        if (action == "archive") args.put("folderId", archiveFolder("mail_list_folders", JSONObject().put("accessToken", token)))
        NativeCore.command(if (action == "delete") "mail_bulk_move_to_trash" else "mail_bulk_move_to_folder", args.toString())
    }

    private fun archiveFolder(command: String, args: JSONObject): String {
        val folders = JSONArray(NativeCore.command(command, args.toString()))
        for (i in 0 until folders.length()) {
            val folder = folders.getJSONObject(i)
            val id = folder.optString("folder_id", folder.optString("folderId"))
            val name = folder.optString("name").lowercase()
            if (id.lowercase() == "archive" || name == "archive" || name == "archives") return id
        }
        error("Archive folder unavailable")
    }

    companion object { const val ACCOUNT_ID="accountId"; const val MESSAGE_ID="messageId"; const val CONVERSATION_ID="conversationId"; const val ACTION="action"; const val DISMISS="dismiss" }
}
