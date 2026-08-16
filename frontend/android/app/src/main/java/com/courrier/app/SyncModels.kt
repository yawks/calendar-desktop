package com.courrier.app

import org.json.JSONObject

data class NewMessage(val id: String, val conversationId: String, val sender: String, val subject: String)
data class DetectionResult(val messages: List<NewMessage>, val cursor: String, val credentialUpdate: JSONObject?)
data class SyncAccount(
    val id: String, val provider: String, val email: String, val displayName: String?,
    val serverUrl: String, val credentials: JSONObject,
    val serverUsername: String? = null, val serverPassword: String? = null,
    val syncIntervalMinutes: Int = 15,
) {
    fun encode() = JSONObject().put("id", id).put("provider", provider).put("email", email)
        .put("displayName", displayName).put("serverUrl", serverUrl).put("serverUsername", serverUsername)
        .put("serverPassword", serverPassword).put("syncIntervalMinutes", syncIntervalMinutes)
        .put("credentials", credentials).toString()
    fun withCredentialUpdate(update: JSONObject): SyncAccount {
        val merged = JSONObject(credentials.toString())
        update.keys().forEach { key -> if (!update.isNull(key)) merged.put(key, update.get(key)) }
        return copy(credentials = merged)
    }
    companion object {
        fun decode(value: String): SyncAccount {
            val item = JSONObject(value)
            return SyncAccount(
                id = item.getString("id"), provider = item.getString("provider"), email = item.getString("email"),
                displayName = item.optString("displayName").ifBlank { null }, serverUrl = item.getString("serverUrl"),
                credentials = item.getJSONObject("credentials"),
                serverUsername = item.optString("serverUsername").ifBlank { null },
                serverPassword = item.optString("serverPassword").ifBlank { null },
                syncIntervalMinutes = item.optInt("syncIntervalMinutes", 15),
            )
        }
    }
}
