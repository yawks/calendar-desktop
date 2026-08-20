package com.courrier.app

import org.json.JSONObject

object NativeCore {
    init { System.loadLibrary("app_lib") }

    private external fun detect(requestJson: String): String
    external fun command(command: String, argumentsJson: String): String

    // JNI string conversion/runtime setup is shared by all workers. WorkManager
    // may start one worker per account at the same instant; serializing detection
    // prevents concurrent calls from reaching Rust with an empty/invalid JSON
    // request (observed as `expected value at line 1 column 1`).
    @Synchronized
    fun detect(account: SyncAccount, cursor: String?): DetectionResult {
        val request = JSONObject()
            .put("provider", account.provider)
            .put("credentials", account.credentials)
            .put("cursor", cursor)
            .put("maxCount", 50)
        val body = JSONObject(detect(request.toString()))
        val messagesJson = body.getJSONArray("messages")
        val messages = (0 until messagesJson.length()).map { index ->
            val item = messagesJson.getJSONObject(index)
            NewMessage(item.getString("id"), item.getString("conversationId"), item.optString("sender"), item.optString("subject"), item.optString("snippet"))
        }
        return DetectionResult(messages, body.getString("cursor"), body.optJSONObject("credentialUpdate"))
    }
}

class NativeMailClient : NewMailDetector {
    override fun detect(account: SyncAccount, cursor: String?) = NativeCore.detect(account, cursor)
}
