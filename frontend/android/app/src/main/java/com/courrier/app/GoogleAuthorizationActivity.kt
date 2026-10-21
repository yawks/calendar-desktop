package com.courrier.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

class GoogleAuthorizationActivity : Activity() {
    private val client by lazy { Identity.getAuthorizationClient(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serverClientId = intent.getStringExtra(EXTRA_CLIENT_ID)
        if (serverClientId.isNullOrBlank()) return fail("Google server client ID is required")
        val scopes = intent.getStringArrayListExtra(EXTRA_SCOPES).orEmpty().map(::Scope)
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            // 21.4 exposes the legacy boolean form; true guarantees a refresh token
            // when an account is re-added after its local credentials were removed.
            .requestOfflineAccess(serverClientId, true)
            .build()
        client.authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val pendingIntent = result.pendingIntent ?: return@addOnSuccessListener fail("Google authorization resolution is unavailable")
                    try { startIntentSenderForResult(pendingIntent.intentSender, REQUEST_AUTHORIZATION, null, 0, 0, 0) }
                    catch (error: Exception) { fail(error.message ?: "Unable to open Google authorization") }
                } else finishWith(result)
            }
            .addOnFailureListener { error -> fail(error.message ?: "Google authorization failed") }
    }

    @Deprecated("Android activity result contract")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_AUTHORIZATION) return
        if (resultCode != RESULT_OK || data == null) return fail("Google authorization cancelled")
        try { finishWith(client.getAuthorizationResultFromIntent(data)) }
        catch (error: Exception) { fail(error.message ?: "Invalid Google authorization result") }
    }

    private fun finishWith(result: AuthorizationResult) {
        val code = result.serverAuthCode
        if (code.isNullOrBlank()) return fail("Google did not return an offline authorization code")
        setResult(RESULT_OK, Intent().putExtra(EXTRA_AUTH_CODE, code)); finish()
    }

    private fun fail(message: String) { setResult(RESULT_CANCELED, Intent().putExtra(EXTRA_ERROR, message)); finish() }

    companion object {
        const val EXTRA_CLIENT_ID = "clientId"; const val EXTRA_SCOPES = "scopes"
        const val EXTRA_AUTH_CODE = "serverAuthCode"; const val EXTRA_ERROR = "error"
        private const val REQUEST_AUTHORIZATION = 4107
    }
}
