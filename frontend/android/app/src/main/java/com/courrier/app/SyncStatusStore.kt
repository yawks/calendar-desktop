package com.courrier.app

import android.content.Context
import org.json.JSONObject

class SyncStatusStore(context: Context) {
    private val preferences = context.getSharedPreferences("native_sync_status", Context.MODE_PRIVATE)

    fun started(accountId: String, now: Long = System.currentTimeMillis()) = update(accountId) {
        put("state", "running").put("lastAttemptAt", now).remove("lastErrorCode")
    }

    fun succeeded(accountId: String, now: Long = System.currentTimeMillis()) = update(accountId) {
        put("state", "success").put("lastSuccessAt", now).remove("lastErrorCode")
    }

    fun failed(accountId: String, code: String, retrying: Boolean, now: Long = System.currentTimeMillis()) = update(accountId) {
        put("state", if (retrying) "retrying" else "error")
            .put("lastFailureAt", now)
            .put("lastErrorCode", code.take(80))
    }

    fun get(accountId: String): JSONObject = JSONObject(preferences.getString(accountId, "{}") ?: "{}")

    fun delete(accountId: String) {
        preferences.edit().remove(accountId).apply()
    }

    private inline fun update(accountId: String, change: JSONObject.() -> Unit) {
        val value = get(accountId)
        value.change()
        preferences.edit().putString(accountId, value.toString()).apply()
    }
}

internal object SyncFailureClassifier {
    private val permanentCodes = setOf(
        "unsupported_provider",
        "invalid_imap_credentials",
        "invalid_jmap_credentials",
        "invalid_exchange_credentials",
        "invalid_gmail_credentials",
        "reauthorization_required",
        "google_oauth_not_configured",
    )

    fun code(error: Throwable): String = error.message
        ?.substringBefore(':')
        ?.trim()
        ?.takeIf { it.matches(Regex("[a-z0-9_]+")) }
        ?: error.javaClass.simpleName

    fun isRetryable(code: String): Boolean = code !in permanentCodes
}
