package com.courrier.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BiometricVault(private val context: Context) {
    companion object {
        const val AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG
        private const val ALIAS = "courrier.vault.biometric.v1"
        private const val PREFS = "courrier_biometric_vault"
        private const val WRAPPED_KEY = "wrapped_key"
    }

    private val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isAvailable(): Boolean =
        BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    fun isEnabled(): Boolean = preferences.contains(WRAPPED_KEY) && loadKey() != null

    fun encryptionCipher(): Cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    }

    fun decryptionCipher(): Cipher {
        val encoded = preferences.getString(WRAPPED_KEY, null) ?: error("Biometric unlock is not configured")
        val encrypted = Base64.decode(encoded, Base64.NO_WRAP)
        require(encrypted.size > 12) { "Invalid biometric vault data" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, loadKey() ?: error("Biometric key is unavailable"), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
        }
    }

    fun store(cipher: Cipher, rawVaultKey: ByteArray) {
        val encrypted = cipher.doFinal(rawVaultKey)
        preferences.edit().putString(WRAPPED_KEY, Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).apply()
    }

    fun unlock(cipher: Cipher): ByteArray {
        val encrypted = Base64.decode(preferences.getString(WRAPPED_KEY, null), Base64.NO_WRAP)
        return cipher.doFinal(encrypted.copyOfRange(12, encrypted.size))
    }

    fun disable() {
        preferences.edit().clear().apply()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS)
    }

    private fun loadKey(): SecretKey? = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        .getKey(ALIAS, null) as? SecretKey

    private fun getOrCreateKey(): SecretKey = loadKey() ?: KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        "AndroidKeyStore",
    ).apply {
        init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationValidityDurationSeconds(-1)
                .setInvalidatedByBiometricEnrollment(true)
                .build(),
        )
    }.generateKey()
}
