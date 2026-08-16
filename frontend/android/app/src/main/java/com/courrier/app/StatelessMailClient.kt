package com.courrier.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

interface NewMailDetector { fun detect(account: SyncAccount, cursor: String?): DetectionResult }

class StatelessMailClient(private val client: OkHttpClient = OkHttpClient()) : NewMailDetector {
    override fun detect(account: SyncAccount, cursor: String?): DetectionResult {
        require(account.serverUrl.startsWith("https://")) { "HTTPS is required" }
        val payload = JSONObject().put("provider", account.provider).put("credentials", account.credentials)
            .put("cursor", cursor).put("maxCount", 50)
        val requestBuilder = Request.Builder().url(account.serverUrl.trimEnd('/') + "/api/mail/sync/detect")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
        if (account.serverUsername != null || account.serverPassword != null) {
            requestBuilder.header("Authorization", Credentials.basic(account.serverUsername ?: "", account.serverPassword ?: ""))
        }
        val request = requestBuilder.build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Courrier sync HTTP " + response.code)
            val body = JSONObject(response.body?.string() ?: "{}")
            val array = body.getJSONArray("messages")
            val messages = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                NewMessage(item.getString("id"), item.getString("conversationId"), item.optString("sender"), item.optString("subject"))
            }
            return DetectionResult(messages, body.getString("cursor"), body.optJSONObject("credentialUpdate"))
        }
    }
}
